import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferralsService } from '../referrals/referrals.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** Shape of the JWT payload stored inside every (short-lived) access token. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  fullName: string;
}

export interface AuthResponse {
  accessToken: string;
  /** Raw refresh token — the caller (AuthController) sets this as an httpOnly cookie, never returns it in JSON. */
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    fullName: string;
    avatarPath?: string | null;
    isVerified: boolean;
  };
}

/**
 * Auth hardening (v0.9.2) — see PRE-LAUNCH-CHECKLIST.md item #2 /
 * README §20 for the full design rationale. Summary:
 *
 * - Access token: short-lived (15m default), returned in the JSON body,
 *   held only in frontend memory (never localStorage).
 * - Refresh token: opaque random value, long-lived (30d default), stored
 *   ONLY as a sha256 hash in the DB, delivered as an httpOnly+secure+
 *   sameSite cookie. Rotated on every use — presenting a refresh token
 *   revokes it and issues a new one.
 * - Reuse detection: if a REVOKED token is ever presented again, that can
 *   only mean it was stolen and the legitimate rotation already happened
 *   (or an attacker is racing the real user) — every token for that user
 *   is revoked, forcing a full re-login. This is the standard mitigation
 *   for refresh token theft, not just documentation of the risk.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private referrals: ReferralsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        passwordHash,
        role: dto.role,
        fullName: dto.fullName.trim(),
        ...(dto.role === 'LANDLORD'
          ? { landlordProfile: { create: {} } }
          : { tenantProfile: { create: {} } }),
      },
    });

    // Attach the referral if a code was supplied. Never allowed to fail a
    // registration — a bad code must not stop someone joining.
    this.referrals.recordSignup(user.id, dto.referralCode).catch(() => {});

    this.logger.log(`New user registered: ${user.email} (${user.role})`);
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase().trim() } });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been suspended. Please contact support.');
    }

    this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

    return this.buildAuthResponse(user);
  }

  /**
   * Issues a session for an already-authenticated user.
   *
   * Public so the magic-link and OAuth paths can reuse it — each proves
   * identity a different way, but what happens afterwards is identical, and
   * duplicating token issuance is how the paths drift apart.
   */
  async issueSessionFor(user: User): Promise<AuthResponse> {
    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been suspended. Please contact support.');
    }
    return this.buildAuthResponse(user);
  }

  async loginWithGoogle(googleUser: {
    googleId: string;
    email: string;
    fullName: string;
    avatarUrl?: string;
    role: 'LANDLORD' | 'TENANT';
  }): Promise<AuthResponse> {
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { authProviderId: googleUser.googleId, authProvider: 'google' },
          { email: googleUser.email.toLowerCase() },
        ],
      },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email.toLowerCase(),
          role: googleUser.role,
          fullName: googleUser.fullName,
          authProvider: 'google',
          authProviderId: googleUser.googleId,
          isVerified: true,
          ...(googleUser.role === 'LANDLORD'
            ? { landlordProfile: { create: {} } }
            : { tenantProfile: { create: {} } }),
        },
      });
      this.logger.log(`New Google user: ${user.email}`);
    }

    return this.buildAuthResponse(user);
  }

  /**
   * Rotates a refresh token: validates it, revokes it, issues a new
   * access + refresh token pair. Throws on any invalid/expired/revoked
   * token — including the reuse-detection case (see class docblock).
   */
  async refresh(rawToken: string): Promise<AuthResponse> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

    if (!stored) {
      throw new UnauthorizedException('Invalid session. Please log in again.');
    }

    if (stored.revokedAt) {
      // Reuse of an already-rotated token — treat as theft, nuke every
      // session for this user rather than trusting anything further.
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId} — revoking all sessions`);
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session security check failed. Please log in again.');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Your session has expired. Please log in again.');
    }
    if (!stored.user.isActive) {
      throw new UnauthorizedException('Your account has been suspended. Please contact support.');
    }

    const { accessToken, refreshToken, refreshTokenId, user } = await this.buildAuthResponse(stored.user);

    // Rotate: mark the presented token as consumed → replaced by the new one.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: refreshTokenId },
    });

    return { accessToken, refreshToken, user };
  }

  /** Revokes a single refresh token — called on logout. */
  async revokeToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, role: true, fullName: true,
        avatarPath: true, isVerified: true, createdAt: true,
        // phone and phoneVerified were missing, so account settings showed an
        // empty phone field after every reload — the value had saved, but the
        // form had no way to read it back and it looked lost.
        phone: true, phoneVerified: true, marketingEmails: true,
      },
    });
  }

  private async buildAuthResponse(user: any): Promise<AuthResponse & { refreshTokenId: string }> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role, fullName: user.fullName };
    const accessToken = this.jwt.sign(payload);
    const { rawToken: refreshToken, id: refreshTokenId } = await this.issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      refreshTokenId,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        avatarPath: user.avatarPath,
        isVerified: user.isVerified,
      },
    };
  }

  private async issueRefreshToken(userId: string): Promise<{ rawToken: string; id: string }> {
    const rawToken = crypto.randomBytes(48).toString('base64url');
    const ttlDays = this.config.get<number>('jwt.refreshTokenTtlDays') ?? 30;

    const record = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });
    return { rawToken, id: record.id };
  }

  /** Refresh tokens are only ever stored as a hash — a DB leak alone can't be used to impersonate anyone. */
  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}
