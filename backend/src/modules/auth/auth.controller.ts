import { Controller, Get, Post, Body, Req, Res, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService, AuthResponse } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const REFRESH_COOKIE = 'rb_refresh';
/** Scoped to /api/auth so it's never sent on unrelated API calls — only auth endpoints need it. */
const REFRESH_COOKIE_PATH = '/api/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private config: ConfigService) {}

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
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Start Google OAuth flow' })
  googleAuth() {}

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
    if (!rawToken) throw new UnauthorizedException('No session found. Please log in again.');

    const result = await this.authService.refresh(rawToken);
    return this.respondWithSession(res, result);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current refresh token and clear the session cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (rawToken) await this.authService.revokeToken(rawToken);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { loggedOut: true };
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
    const isSecureEnv = this.config.get<string>('env') !== 'development';
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isSecureEnv, // both staging and production are served over HTTPS — only local dev is plain HTTP
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: (this.config.get<number>('jwt.refreshTokenTtlDays') ?? 30) * 24 * 60 * 60 * 1000,
    });
  }
}
