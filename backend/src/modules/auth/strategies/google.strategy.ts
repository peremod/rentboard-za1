import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

/**
 * Handles the Google OAuth 2.0 handshake. Only requests email + profile scopes.
 *
 * Google login is OPTIONAL — email/password auth works without it. Passport's
 * OAuth2Strategy throws 'requires a clientID option' from its constructor when
 * unconfigured, which previously aborted Nest bootstrap and took the whole API
 * down. Placeholder values keep the provider constructible; the OAuth routes
 * are separately guarded (see AuthController.googleAuth) so an unconfigured
 * server returns a clear 503 instead of a confusing redirect to Google.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private static readonly logger = new Logger(GoogleStrategy.name);

  /** True only when real Google credentials are present. */
  static isConfigured = false;

  constructor(config: ConfigService) {
    const clientID = config.get<string>('google.clientId');
    const clientSecret = config.get<string>('google.clientSecret');
    const callbackURL = config.get<string>('google.callbackUrl');
    const configured = Boolean(clientID && clientSecret);

    super({
      clientID: clientID || 'google-oauth-not-configured',
      clientSecret: clientSecret || 'google-oauth-not-configured',
      callbackURL: callbackURL || 'http://localhost:3000/api/auth/google/callback',
      scope: ['email', 'profile'],
    });

    GoogleStrategy.isConfigured = configured;
    if (!configured) {
      GoogleStrategy.logger.warn(
        'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set — "Continue with Google" is disabled. Email and password login is unaffected.',
      );
    }
  }

  async validate(_accessToken: string, _refreshToken: string, profile: any, done: VerifyCallback) {
    const { id, emails, displayName, photos } = profile;
    done(null, {
      googleId: id,
      email: emails[0].value,
      fullName: displayName,
      avatarUrl: photos?.[0]?.value,
    });
  }
}
