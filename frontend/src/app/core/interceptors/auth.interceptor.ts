import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '@env/environment';

/** Endpoints that must never wait on the session — they are what establishes it. */
const SESSION_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/google'];

const isSessionEndpoint = (url: string) => SESSION_ENDPOINTS.some((p) => url.includes(p));

/**
 * Public reads a server-side render is allowed to make.
 *
 * These need no session, answer the same for everyone, and are exactly the
 * data the crawlable pages are made of: the board's listings, a room, its
 * reviews, the place taxonomy behind the filters, and the board's ad slots.
 *
 * Anything not on this list is still dropped during SSR — see below.
 */
// '/storefronts' added for Phase 5b. Without it the server render would skip the
// fetch and the page would be delivered to a crawler reading "Loading…", which
// is exactly the defect verify-build.sh checks for on room pages.
const SSR_PUBLIC_PREFIXES = ['/rooms', '/reviews', '/places', '/ads', '/storefronts'];

const isPublicRead = (req: { url: string; method: string }) => {
  if (req.method !== 'GET') return false;
  const path = req.url.slice(environment.apiUrl.length);
  return SSR_PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
};

/**
 * Reads whose answer does not depend on WHO is asking.
 *
 * ⚠️ This is deliberately NOT `isPublicRead`, and the difference is the whole
 * point. That one answers "may a server-side render fetch this?", where a
 * false positive costs nothing because the server has no token to leak into
 * one. This answers "may the BROWSER leave its credentials off?", where a
 * false positive silently signs the request out — so it is an exact list, not
 * a prefix sweep, and every entry below was checked against its controller.
 *
 * `isPublicRead` matches by prefix, so it is true for `/reviews/mine`,
 * `/ads/enquiries`, `/ads/advertisers` and `/ads/reach-analysis` — every one
 * of them behind JwtAuthGuard. Reusing it here would have stripped the token
 * from authenticated screens and broken them, which no check on the public
 * board would ever have noticed.
 *
 * ⚠️ `/rooms/:id` is NOT here, and must not be. It takes OptionalJwtAuthGuard
 * and hands `user?.id` to findOne, which uses it twice: an owner may fetch
 * their own `draft` or `deleted` room (everyone else gets 404), and the view
 * counters are only incremented `if (!isOwner)`. Anonymous, a landlord opening
 * their own draft would get a 404 and a landlord opening their live room would
 * inflate their own view count.
 *
 * Verified against the controllers, one at a time:
 *   GET /rooms              no guard, no @CurrentUser, Cache-Control: public
 *   GET /rooms/suggest      no guard
 *   GET /rooms/categories   no guard
 *   GET /places/suggest     no guard
 *   GET /places/resolve     no guard
 *   GET /reviews/room/:id        no guard
 *   GET /reviews/landlord/:id    no guard
 */
const VIEWER_INDEPENDENT_READS = [
  '/rooms/suggest',
  '/rooms/categories',
  '/places/suggest',
  '/places/resolve',
  '/reviews/room/',
  '/reviews/landlord/',
];

export const isViewerIndependentRead = (req: { url: string; method: string }) => {
  if (req.method !== 'GET') return false;
  if (!req.url.startsWith(environment.apiUrl)) return false;
  const path = req.url.slice(environment.apiUrl.length);
  // The board itself: '/rooms' exactly, or '/rooms?filters'. NOT '/rooms/…',
  // which is where '/rooms/:id' lives.
  if (path === '/rooms' || path.startsWith('/rooms?')) return true;
  return VIEWER_INDEPENDENT_READS.some((p) => path === p || path.startsWith(p) || path.startsWith(p.replace(/\/$/, '') + '?'));
};

/**
 * Attaches the access token to requests going to our own API, and marks every
 * such request withCredentials so the httpOnly refresh cookie is sent and
 * received. Not applied to third-party requests such as ImageKit.
 *
 * It also HOLDS requests until the startup session refresh has settled.
 *
 * That is the important part. On a reload the dashboard fires its calls as
 * soon as it renders, and those left before the refresh had returned a token —
 * so four requests went out unauthenticated, came back 401, and the error
 * interceptor treated that as an expired session and redirected to login.
 * The recovery then navigated back, the dashboard mounted again, and the whole
 * cycle repeated: the seven identical rounds of 401s in the console.
 *
 * Waiting costs one round trip that was already happening, and removes the
 * entire class of problem rather than handling its symptoms downstream.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  // On the server there is no cookie and no token, so a request needing one is
  // guaranteed to 401. The guards let routes through during SSR so the server
  // does not render a signed-out page, which means the portal components mount
  // and fire their loads there too — guaranteed 401s per render, logged in the
  // frontend terminal rather than the browser. Those routes are client-
  // rendered, so nothing is lost by not fetching: the browser loads the data
  // itself a moment later.
  //
  // But this used to drop EVERY request during SSR, public ones included, and
  // returning EMPTY completes the observable without a value — so neither the
  // `next` nor the `error` handler ran. The consequence was not a logging
  // detail: /rooms/:id is server-rendered per request precisely so a crawler
  // sees the room, and it rendered "Loading…" with the site's default title
  // and description and no JSON-LD, on every room page, for every crawler.
  // The prerendered board came out of the build with its empty state, and a
  // room id that does not exist rendered its 200 instead of its not-found
  // branch, because the branch is chosen by the response that never arrived.
  //
  // So: public reads go through on the server. Everything else still does not.
  if (!auth.isBrowserPlatform && !isSessionEndpoint(req.url) && !isPublicRead(req)) {
    return EMPTY;
  }

  // Server-side, a public read carries no credentials — there are none to
  // carry — and must not wait on a session refresh that cannot happen.
  if (!auth.isBrowserPlatform) return next(req);

  /**
   * ⚠️ A public read goes out from the browser EXACTLY as the server sent it:
   * no cookie, no token, and no waiting on the session.
   *
   * This is docs/OUTSTANDING.md §103 — the board being fetched twice on every
   * first visit, with the server's copy thrown away. The response IS in the
   * page: the server renders the board and serialises it into
   * `<script id="ng-state">`. Angular's HTTP transfer cache then refuses to
   * serve it, because by the time its interceptor sees the request this one
   * has cloned it `withCredentials: true` — and a credentialed response is
   * never served from the transfer cache, by design, since it may be
   * user-specific. The server's copy is not credentialed; the browser's ask
   * for the same thing is. So they are not the same request, and the browser
   * goes to the network for a board that is already on screen.
   *
   * Measured before the change, with the API held open for 12s to imitate a
   * waking instance: 12 cards at 431ms, back to six skeletons at 917ms, the
   * answer at 13s. Warm it costs ~300ms and nobody sees it.
   *
   * Nothing is given up. These endpoints are the ones SSR already fetches
   * anonymously — the list above says they "need no session, answer the same
   * for everyone", and that premise is load-bearing already: the server
   * renders them signed-out and that HTML is what every visitor gets.
   * `GET /api/rooms` takes no user at all (no guard, no @Req, and the
   * controller sets `Cache-Control: public`).
   *
   * And it does not wait on sessionReady() either. A read that needs no
   * session has nothing to wait for, and the wait was pushing the board's
   * first request a whole refresh round trip later.
   */
  if (isViewerIndependentRead(req)) return next(req);

  const attach = () => {
    const token = auth.token();
    return next(req.clone({
      withCredentials: true,
      ...(token && { setHeaders: { Authorization: `Bearer ${token}` } }),
    }));
  };

  // Session endpoints cannot wait on the session they are establishing.
  if (isSessionEndpoint(req.url) || auth.sessionResolved()) return attach();

  return auth.sessionReady().pipe(switchMap(attach));
};
