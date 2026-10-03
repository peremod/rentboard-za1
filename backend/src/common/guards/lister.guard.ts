import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * May this account hold a room listing at all — Phase 6, Option A.
 *
 * ── Why a second guard rather than loosening LandlordGuard
 *
 * Because the two questions are genuinely different, and `LandlordGuard`
 * answers the one that still needs asking. A sub-lessor runs a listing: they
 * create it, publish it, read its applicants, accept somebody. A sub-lessor is
 * NOT the owner of the address, and the endpoints that assume ownership stay
 * exactly as they were — rent tracking, expenses, the yard, the storefront, the
 * paid identity badge, listing by WhatsApp. Widening `LandlordGuard` would have
 * opened all of it in one edit, silently, and the reviewer of that diff would
 * have had to notice fifty-two call sites to catch it.
 *
 * So: `ListerGuard` on what a lister does, `LandlordGuard` left on what an
 * owner does. The split is visible in the diff, route by route.
 *
 * ── What this does NOT do
 *
 * It does not check ownership of a particular room. Every service here scopes
 * its query by `landlordId` and that is where per-resource authorisation lives
 * — the same reason `LandlordGuard` admitting `ADMIN` was never enough on its
 * own. A guard says who may try; the WHERE clause says whose rows they get.
 *
 * ⚠️ It therefore admits any signed-in, active account, which is deliberate:
 * under Option A anybody may list a room they are letting out, and what differs
 * is the `listerType` they are allowed to claim. A `TENANT` may only hold a
 * `sublessor` listing, and that is enforced in RoomsService.create, where the
 * listing data actually is — not here, where there is no listing to inspect.
 */
@Injectable()
export class ListerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Sign in to manage a listing');
    // JwtStrategy already refuses a suspended account, so there is no isActive
    // check here; adding one would read as though it were the control.
    if (user.role !== 'LANDLORD' && user.role !== 'TENANT' && user.role !== 'ADMIN') {
      throw new ForbiddenException('This account cannot hold a listing');
    }
    return true;
  }
}
