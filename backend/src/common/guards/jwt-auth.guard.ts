import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UnauthorizedException } from '@nestjs/common';

/** Extends Passport's guard to return helpful, consistent error messages. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      const message =
        info?.name === 'TokenExpiredError' ? 'Your session has expired. Please log in again.' :
        info?.name === 'JsonWebTokenError' ? 'Invalid authentication token.' :
        'Authentication required. Please log in.';
      throw new UnauthorizedException(message);
    }
    return user;
  }
}
