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
import { PhoneCodeDto, VerifyPhoneDto, ConfirmNumberDto } from './dto/phone-otp.dto';
import { MagicLinkDto, VerifyMagicLinkDto } from './dto/passwordless.dto';
import { Throttle } from '@nestjs/throttler';
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
    private authService: AuthService, private config: ConfigService) {}

  @Post('register')
  @ApiOperation({ summary: 'Create a new account (tenant or landlord)' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    return this.respondWithSession(res, result);
  }

  @Post('login')
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
      this.logger.warn(
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
    res.clearCookie(REFRESH_COOKIE, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      secure: true,
      sameSite: this.config.get<string>('env') === 'development' ? 'none' : 'strict',
    });
    return { loggedOut: true };
  }

  // ── Account recovery ────────────────────────────────────────────────────
  // Rate limited harder than the defaults: these endpoints accept an email and
  // send mail, so they are the obvious target for enumeration and spam.

  @Post('magic-link')
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a passwordless sign-in link',
    description: 'Always reports success, whether or not the address has an account.',
  })
  magicLink(@Body() dto: MagicLinkDto) {
    return this.passwordless.requestMagicLink(dto.email, dto.role);
  }

  @Post('magic-link/verify')
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a code to verify the number on your account' })
  requestPhoneVerification(@CurrentUser() user: { id: string }) {
    return this.phoneOtp.requestVerification(user.id);
  }

  @Post('phone/confirm-number')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the code and enable WhatsApp sign-in' })
  confirmPhoneVerification(
    @Body() dto: ConfirmNumberDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.phoneOtp.confirmVerification(user.id, dto.code);
  }

  @Post('phone/request-code')
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a sign-in code over WhatsApp' })
  requestPhoneCode(@Body() dto: PhoneCodeDto) {
    return this.phoneOtp.requestCode(dto.phone);
  }

  @Post('phone/verify')
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a phone code for a session' })
  async verifyPhoneCode(@Body() dto: VerifyPhoneDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.phoneOtp.verifyCode(dto.phone, dto.code);
    const result = await this.authService.issueSessionFor(user);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken, ...body } = result;
    return body;
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a reset link. Always reports success, existing account or not.' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.recovery.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
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
    return this.recovery.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Post('change-email')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start an email change. Confirmed at the new address.' })
  requestEmailChange(@Body() dto: RequestEmailChangeDto, @CurrentUser() user: { id: string }) {
    return this.recovery.requestEmailChange(user.id, dto.newEmail, dto.currentPassword);
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
    const isDev = this.config.get<string>('env') === 'development';

    // In production the app and API share a registrable domain
    // (rentboard.co.za and api.rentboard.co.za), so the cookie is same-site and
    // 'strict' is both correct and the strongest CSRF protection available.
    //
    // In development they are different ORIGINS on localhost. Whether a browser
    // treats that as same-site has varied, and when it does not, 'strict' means
    // the cookie is stored and then never sent — which presents as being signed
    // out on every reload with a valid cookie sitting in the jar.
    //
    // 'none' requires Secure, and Chrome accepts Secure cookies over
    // http://localhost because localhost is a trustworthy origin. So this is
    // safe on plain HTTP in dev and never applies anywhere else.
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: isDev ? 'none' : 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: (this.config.get<number>('jwt.refreshTokenTtlDays') ?? 30) * 24 * 60 * 60 * 1000,
    });
  }
}
