import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

/** Handles the Google OAuth 2.0 handshake. Only requests email + profile scopes. */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('google.clientId')!,
      clientSecret: config.get<string>('google.clientSecret')!,
      callbackURL: config.get<string>('google.callbackUrl')!,
      scope: ['email', 'profile'],
    });
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
