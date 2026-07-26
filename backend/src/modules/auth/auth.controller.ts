import { Controller, Get, Post, Body, Req, Res, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Create a new account (tenant or landlord)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Email + password login' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** GET /api/auth/google — redirects to Google's consent screen. Passport handles this. */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Start Google OAuth flow' })
  googleAuth() {}

  /**
   * GET /api/auth/google/callback — Google redirects here after consent.
   * `returnUrl` is round-tripped from the frontend so post-login redirect works
   * even through OAuth (see frontend AuthCallbackComponent, added in this pass).
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('role') role: 'TENANT' | 'LANDLORD' = 'TENANT',
    @Query('returnUrl') returnUrl?: string,
  ) {
    const result = await this.authService.loginWithGoogle({ ...(req.user as any), role });
    const params = new URLSearchParams({
      token: result.accessToken,
      ...(returnUrl ? { returnUrl } : {}),
    });
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?${params.toString()}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get the current authenticated user' })
  getMe(@CurrentUser() user: { id: string }) {
    return this.authService.getMe(user.id);
  }
}
