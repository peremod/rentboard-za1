import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** Shape of the JWT payload stored inside every access token. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  fullName: string;
}

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    fullName: string;
    avatarPath?: string | null;
    isVerified: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** bcrypt cost factor — 12 is the current secure standard (2^12 iterations). */
  private readonly SALT_ROUNDS = 12;

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  /**
   * Register a new account. Creates User + role-specific profile
   * (LandlordProfile or TenantProfile) in one write.
   */
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

    this.logger.log(`New user registered: ${user.email} (${user.role})`);
    return this.buildAuthResponse(user);
  }

  /**
   * Login with email + password.
   * Returns the SAME error for "not found" and "wrong password" —
   * prevents attackers from using the endpoint to enumerate valid emails.
   */
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

    // Fire-and-forget — never block the login response on this write.
    this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

    return this.buildAuthResponse(user);
  }

  /**
   * Google OAuth callback handler. Creates the account on first login
   * (pre-verified — Google already confirmed the email), or logs in
   * the existing account matched by googleId or email.
   */
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

  /** GET /auth/me — called after JwtAuthGuard validates the token. */
  async getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, role: true, fullName: true,
        avatarPath: true, isVerified: true, createdAt: true,
      },
    });
  }

  private buildAuthResponse(user: any): AuthResponse {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role, fullName: user.fullName };
    return {
      accessToken: this.jwt.sign(payload),
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
}
