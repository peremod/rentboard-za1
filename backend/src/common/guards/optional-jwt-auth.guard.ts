import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Populates req.user when a valid token is present, and allows the request
 * through unchanged when it is absent or invalid.
 *
 * Used on public endpoints that behave slightly differently for a signed-in
 * viewer — currently GET /rooms/:id, which must not count a landlord's own
 * views against their listing but must still serve anonymous visitors.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    return user || undefined;   // never throws
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
