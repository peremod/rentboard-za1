import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { PhoneSignupAdminController } from './phone-signup-admin.controller';
import { LostNumberAdminController, LostNumberPublicController } from './lost-number.controller';
import { LostNumberService } from './lost-number.service';
import { AuthService } from './auth.service';
import { AccountRecoveryService } from './account-recovery.service';
import { PasswordlessService } from './passwordless.service';
import { PhoneOtpService } from './phone-otp.service';
import { PhoneSignupService } from './phone-signup.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    NotificationsModule,
    ReferralsModule,
    WhatsappModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // @nestjs/jwt 11 types signOptions.expiresIn as ms's StringValue
      // template-literal union, so a plain string needs an explicit cast.
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('jwt.secret')!,
        signOptions: {
          expiresIn: config.get<string>('jwt.expiresIn') ?? '24h',
        } as JwtModuleOptions['signOptions'],
      }),
    }),
  ],
  controllers: [
    AuthController,
    PhoneSignupAdminController,
    // Phase 7q. Two controllers for one service: every admin route is guarded,
    // and the one the person recovering uses cannot be — they have no session,
    // which is the premise.
    LostNumberAdminController,
    LostNumberPublicController,
  ],
  providers: [
    AuthService,
    AccountRecoveryService,
    PasswordlessService,
    PhoneOtpService,
    PhoneSignupService,
    JwtStrategy,
    GoogleStrategy,
    LostNumberService,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
