import { Controller, Get, Post, Body, Req, Res, Query, UseGuards, UnauthorizedException, Next, ServiceUnavailableException, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as passport from 'passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService, AuthResponse } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto,
  RequestEmailChangeDto, ConfirmEmailChangeDto,
} from './dto/account-recovery.dto';
import { AccountRecoveryService } from './account-recovery.service';
import { PasswordlessService } from './passwordless.service';
import { PhoneOtpService } from './phone-otp.service';
import { PhoneSignupService } from './phone-signup.service';
import {
  PhoneCodeDto, VerifyPhoneDto, ConfirmNumberDto, CompletePhoneSignupDto, RequestPhoneChangeDto,
} from './dto/phone-otp.dto';
import { MagicLinkDto, VerifyMagicLinkDto } from './dto/passwordless.dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const REFRESH_COOKIE = 'rb_refresh';
/** Scoped to /api/auth so it's never sent on unrelated API calls — only auth endpoints need it. */
const REFRESH_COOKIE_PATH = '/api/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private recovery: AccountRecoveryService,
    private passwordless: PasswordlessService,
    private phoneOtp: PhoneOtpService,
    private phoneSignup: PhoneSignupService,
    private authService: AuthService, private config: ConfigService) {}

  @Post('register')
  // Sixty an hour from one address.
  //
  // This was ten, which is what "far more than a person needs" looks like until
  // you ask who shares an address here. Three cases break it, and all three are
  // ways this product is meant to grow: a community sign-up drive where an agent
  // helps a row of landlords join on one wifi; a building or a café behind one
  // connection; and carrier NAT, which puts very large numbers of subscribers
  // behind a single IP. Refusing the eleventh person at a launch event is a
  // worse outcome than the thing the limit prevents.
  //
  // Sixty still stops a script cold — it is one a minute, sustained — and
  // account farming has better controls behind this anyway: referral rewards
  // fire on a qualifying action rather than on signup, and a phone sign-up costs
  // a code to a real handset.
  //
  // (The test suites register several accounts per run from one address, which
  // is what made me look at this number properly. That is not the reason for
  // the change, but it is how the question got asked.)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Create a new account (tenant or landlord)' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    return this.respondWithSession(res, result);
  }

  @Post('login')
  // There was no limit here at all — not an inert one, none. Password guessing
  // against this endpoint was unmetered, which makes it the most exposed route
  // in the API: /auth/phone/verify at least faces a six-digit code with a
  // per-account cap behind it.
  //
  // Thirty per fifteen minutes, for the carrier-NAT reason in app.module.ts: a
  // household, a café or a whole carrier shares one address, and a person who
  // has forgotten which of their two passwords it is uses three on their own.
  // Thirty is still two orders of magnitude short of a useful password spray,
  // and the control that would actually stop one is per-account, which does not
  // exist yet and is written down rather than implied.
  //
  // ⚠️ This is a per-IP control and there is still no per-ACCOUNT lockout, so a
  // slow distributed spray against one address remains possible. Recorded in
  // docs/OUTSTANDING.md rather than left implied by the presence of a limit.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  @ApiOperation({ summary: 'Email + password login' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    return this.respondWithSession(res, result);
  }

  @Get('google')
  @ApiOperation({ summary: 'Start Google OAuth flow' })
  googleAuth(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    // Fail loudly and clearly when Google credentials are absent, rather than
    // redirecting the user to Google with a placeholder client_id.
    if (!GoogleStrategy.isConfigured) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on this server. Use email and password, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the backend .env file.',
      );
    }
    return passport.authenticate('google', { scope: ['email', 'profile'] })(req, res, next);
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('role') role: 'TENANT' | 'LANDLORD' = 'TENANT',
    @Query('returnUrl') returnUrl?: string,
  ) {
    const result = await this.authService.loginWithGoogle({ ...(req.user as any), role });
    this.setRefreshCookie(res, result.refreshToken);

    // Access token still round-trips via URL fragment here (not query string,
    // so it never lands in server logs or Referer headers) — the OAuth
    // redirect has no other channel back to the SPA. AuthCallbackComponent
    // reads it once and never persists it.
    const params = new URLSearchParams({ token: result.accessToken, ...(returnUrl ? { returnUrl } : {}) });
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback#${params.toString()}`);
  }

  /**
   * Reads the refresh token from the httpOnly cookie, rotates it, returns a
   * fresh access token. Called by the frontend's error interceptor on a 401,
   * and on app startup to silently restore a session.
   */
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the refresh token, issue a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken) {
      // Logged because a missing cookie and a rejected one look identical from
      // the browser — both just sign the person out. Naming which cookies did
      // arrive distinguishes 'never set' from 'not sent on this request'.
      // debug, not warn. Every anonymous page load attempts a refresh and has
      // no cookie by definition, so at warn level this filled the log with an
      // expected condition and made a genuinely broken session indis-
      // tinguishable from someone simply browsing signed out. I read it as
      // evidence of a bug more than once.
      this.logger.debug(
        `Refresh called with no ${REFRESH_COOKIE} cookie. Cookies present: ` +
        `${Object.keys(req.cookies ?? {}).join(', ') || 'none'}`,
      );
      throw new UnauthorizedException('No session found. Please log in again.');
    }

    const result = await this.authService.refresh(rawToken);
    return this.respondWithSession(res, result);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current refresh token and clear the session cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (rawToken) await this.authService.revokeToken(rawToken);
    // Attributes must match the ones it was set with, or the browser treats
    // this as a different cookie and leaves the original in place — logout
    // would appear to work while the session stayed alive.
    // Attributes must match the ones it was set with, or the browser treats
    // this as a different cookie and leaves the original in place.
    res.clearCookie(REFRESH_COOKIE, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      secure: this.config.get<string>('env') !== 'development',
      sameSite: 'strict',
    });
    return { loggedOut: true };
  }

  // ── Account recovery ────────────────────────────────────────────────────
  // Rate limited harder than the defaults: these endpoints accept an email and
  // send mail, so they are the obvious target for enumeration and spam.

  @Post('magic-link')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 15, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a passwordless sign-in link',
    description: 'Always reports success, whether or not the address has an account.',
  })
  magicLink(@Body() dto: MagicLinkDto) {
    return this.passwordless.requestMagicLink(dto.email, dto.role);
  }

  @Post('magic-link/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a sign-in link for a session' })
  async verifyMagicLink(@Body() dto: VerifyMagicLinkDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.passwordless.consumeMagicLink(dto.token);
    const result = await this.authService.issueSessionFor(user);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...body } = result;
    return body;
  }

  @Post('phone/verify-number')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 15, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a code to verify the number on your account' })
  requestPhoneVerification(@CurrentUser() user: { id: string }) {
    return this.phoneOtp.requestVerification(user.id);
  }

  @Post('phone/confirm-number')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  // Every other OTP route carried an explicit limit and this one did not, which
  // was the reason it was added — on the understanding that it was falling back
  // to a global 150 per 15 minutes. It was not: no limit of any kind was in
  // force anywhere, because ThrottlerGuard was never registered (see
  // app.module.ts). The decorator is real now, and matched to phone/verify.
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  @ApiOperation({ summary: 'Confirm the code and enable WhatsApp sign-in' })
  confirmPhoneVerification(
    @Body() dto: ConfirmNumberDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.phoneOtp.confirmVerification(user.id, dto.code);
  }

  @Post('phone/request-code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 15, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a sign-in code over WhatsApp' })
  requestPhoneCode(@Body() dto: PhoneCodeDto) {
    return this.phoneOtp.requestCode(dto.phone);
  }

  @Post('phone/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a phone code for a session' })
  async verifyPhoneCode(@Body() dto: VerifyPhoneDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.phoneOtp.verifyCode(dto.phone, dto.code);
    const result = await this.authService.issueSessionFor(user);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...body } = result;
    return body;
  }

  /**
   * Phone SIGN-UP, step one — Phase 7g part two.
   *
   * Separate from phone/request-code, which only ever finds an existing verified
   * account. This one is for a number that has none, and it creates no account:
   * see PhoneSignupService.
   */
  @Post('phone/signup/request-code')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 15, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a sign-up with a code over WhatsApp' })
  requestSignupCode(@Body() dto: PhoneCodeDto) {
    return this.phoneSignup.requestCode(dto.phone);
  }

  /** Step two: the code, for a short-lived ticket proving the number. */
  @Post('phone/signup/verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the sign-up code' })
  verifySignupCode(@Body() dto: VerifyPhoneDto) {
    return this.phoneSignup.verify(dto.phone, dto.code);
  }

  /**
   * Step three: the account, and a session.
   *
   * Tighter than the steps before it. Those cost a WhatsApp message; this one
   * creates a user, and five accounts a quarter of an hour from one address is
   * already far more than anybody signing up for themselves needs.
   */
  @Post('phone/signup/complete')
  @UseGuards(ThrottlerGuard)
  // Twenty an hour. Tighter per hour than the steps before it, but not as tight
  // as it first looked right to make it: this route cannot be reached without a
  // ticket, and a ticket costs a code to a real handset that answered it. The
  // account-creation rate is therefore already bounded by the limits on
  // request-code and by the per-number caps in the service, and a very low
  // number here only locks out the test suites that exercise the refusals.
  @Throttle({ default: { limit: 20, ttl: 60 * 60 * 1000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create the account for a proven number' })
  async completeSignup(
    @Body() dto: CompletePhoneSignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.phoneSignup.complete(dto);
    const result = await this.authService.issueSessionFor(user);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...body } = result;
    return body;
  }

  @Post('forgot-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 15, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a reset link. Always reports success, existing account or not.' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.recovery.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.recovery.resetPassword(dto.token, dto.newPassword);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password while signed in. Requires the current one.' })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: { id: string }) {
    return this.recovery.changePassword(
      user.id, dto.currentPassword ?? '', dto.newPassword, dto.phoneCode,
    );
  }

  @Post('change-email')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start an email change. Confirmed at the new address.' })
  requestEmailChange(@Body() dto: RequestEmailChangeDto, @CurrentUser() user: { id: string }) {
    return this.recovery.requestEmailChange(
      user.id, dto.newEmail, dto.currentPassword ?? '', dto.phoneCode,
    );
  }

  // ── Changing the number, proven before it lands — Phase 7o ───────────────
  //
  // ⚠️ Not a field on the profile form. It was one, and on an account whose
  // number is the only credential a mistyped digit was a permanent lockout —
  // see UsersService.updateProfile and PhoneOtpService.requestPhoneChange.

  @Post('phone/change/request-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a code to a NEW number. The account keeps its current one until confirmed.',
  })
  requestPhoneChange(@Body() dto: RequestPhoneChangeDto, @CurrentUser() user: { id: string }) {
    return this.phoneOtp.requestPhoneChange(user.id, dto.newPhone);
  }

  @Post('phone/change/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The code came back from the new number, so switch to it' })
  confirmPhoneChange(@Body() dto: ConfirmNumberDto, @CurrentUser() user: { id: string }) {
    return this.phoneOtp.confirmPhoneChange(user.id, dto.code);
  }

  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email change from the link sent to the new address' })
  confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    return this.recovery.confirmEmailChange(dto.token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the current authenticated user' })
  getMe(@CurrentUser() user: { id: string }) {
    return this.authService.getMe(user.id);
  }

  /** Sets the refresh cookie and strips it out of the JSON body — the raw token must never appear there. */
  private respondWithSession(res: Response, result: AuthResponse) {
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...body } = result;
    return body;
  }

  private setRefreshCookie(res: Response, token: string) {
    // An empty token means a refresh race was resolved by returning the
    // existing session. The browser already holds the valid cookie, and
    // overwriting it with nothing would sign them out.
    if (!token) return;

    const isDev = this.config.get<string>('env') === 'development';

    // sameSite 'strict' everywhere, and the request trace confirms it works in
    // development: Chrome reports sec-fetch-site: same-site for localhost:4200
    // calling localhost:3000, because ports do not affect same-site.
    //
    // I briefly set 'none' here on the theory that dev was cross-site. It was
    // not, and 'none' stopped the cookie being sent at all — the opposite of
    // the intended effect. Strict is both correct and the stronger CSRF
    // protection, so it stays.
    //
    // secure is off in development only. A Secure cookie over plain http is
    // discarded by some browsers, and dev is the only environment not served
    // over HTTPS.
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: !isDev,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: (this.config.get<number>('jwt.refreshTokenTtlDays') ?? 30) * 24 * 60 * 60 * 1000,
    });
  }

}
