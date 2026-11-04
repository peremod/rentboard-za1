import { describe, it, expect } from 'vitest';
import { isViewerIndependentRead } from './auth.interceptor';
import { environment } from '@env/environment';

/**
 * Which reads the browser may send with no cookie and no token.
 *
 * ⚠️ Why this file exists. The first version of the change reused
 * `isPublicRead`, the predicate that decides what a server-side render may
 * fetch. That one matches by PREFIX, so it is true for `/reviews/mine`,
 * `/ads/enquiries`, `/ads/advertisers` and `/ads/reach-analysis` — every one
 * of them behind JwtAuthGuard. As "may SSR fetch this?" a false positive costs
 * nothing, because the server has no token to omit. As "may the browser leave
 * its credentials off?" every false positive silently signs a request out.
 *
 * None of that is visible from the public board, which is the only thing the
 * §103 drive loads. So the cases below are the ones a browser drive would not
 * have caught, written down as a list rather than as a hope.
 */
const api = environment.apiUrl;
const get = (path: string) => ({ url: `${api}${path}`, method: 'GET' });

describe('isViewerIndependentRead — the browser may drop its credentials', () => {
  it('matches the board itself, with and without filters', () => {
    expect(isViewerIndependentRead(get('/rooms'))).toBe(true);
    expect(isViewerIndependentRead(get('/rooms?page=1&limit=12&sortBy=newest'))).toBe(true);
  });

  it('matches the unguarded lookups the filters and detail pages use', () => {
    for (const p of [
      '/rooms/suggest?q=spr',
      '/rooms/categories',
      '/places/suggest?q=ger',
      '/places/resolve?city=Springs',
      '/reviews/room/abc-123',
      '/reviews/landlord/abc-123',
    ]) {
      expect(isViewerIndependentRead(get(p)), p).toBe(true);
    }
  });

  // ⚠️ The two cases below are the whole reason this file exists.
  it('does NOT match /rooms/:id — an owner sees their own draft there', () => {
    // OptionalJwtAuthGuard, and findOne uses the viewer twice: an owner may
    // fetch a draft or deleted room, and the view counters only increment
    // `if (!isOwner)`. Anonymous, a landlord gets 404 on their own draft and
    // inflates their own view count on their live room.
    expect(isViewerIndependentRead(get('/rooms/0f0a3f2c-1111-2222-3333-444455556666'))).toBe(false);
    expect(isViewerIndependentRead(get('/rooms/abc-123'))).toBe(false);
  });

  it('does NOT match the authenticated reads that share a prefix', () => {
    // Each of these is matched by isPublicRead and is behind a guard.
    for (const p of [
      '/reviews/mine',
      '/reviews/tenant/abc-123/references',
      '/ads/enquiries',
      '/ads/advertisers',
      '/ads/reach-analysis',
    ]) {
      expect(isViewerIndependentRead(get(p)), p).toBe(false);
    }
  });

  it('does not match a write, whatever the path', () => {
    expect(isViewerIndependentRead({ url: `${api}/rooms`, method: 'POST' })).toBe(false);
    expect(isViewerIndependentRead({ url: `${api}/rooms?x=1`, method: 'DELETE' })).toBe(false);
  });

  it('does not match a third party — credentials were never sent there anyway', () => {
    expect(isViewerIndependentRead({ url: 'https://ik.imagekit.io/rooms?x=1', method: 'GET' })).toBe(false);
    expect(isViewerIndependentRead({ url: 'https://evil.example/rooms', method: 'GET' })).toBe(false);
  });
});
