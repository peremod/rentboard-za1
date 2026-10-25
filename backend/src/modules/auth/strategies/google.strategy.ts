import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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

    /**
     * ⚠️ `emails` is a list Google is not obliged to fill, and the line below
     * it already knew that.
     *
     * `photos?.[0]?.value` is guarded; `emails[0].value` was not, one line
     * apart. A profile with no email — the scope withheld, or an account
     * without a verified address — was a TypeError inside a Passport verify
     * callback, which surfaces as a 500 on the sign-in redirect with nothing
     * naming the cause.
     *
     * Found while tracing the tenant inbox's 500 (§91): the same class, an
     * index into a list nothing promised was non-empty. It is a refusal with a
     * reason now, because an email is not optional here — the account IS the
     * email address, and `User.email` being nullable is for the WhatsApp-first
     * landlord who has a phone number instead, not for a Google account that
     * came back without one.
     */
    if (!emails?.length || !emails[0]?.value) {
      done(
        new UnauthorizedException(
          'Google did not share an email address for that account. '
          + 'Sign in with an email and password instead, or try a Google account with a verified address.',
        ),
        false,
      );
      return;
    }

    done(null, {
      googleId: id,
      email: emails[0].value,
      fullName: displayName,
      avatarUrl: photos?.[0]?.value,
    });
  }
}
