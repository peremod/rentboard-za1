import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * How long a request took, logged when it took too long.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * Before this, the API measured nothing. The frontend had Lighthouse CI on
 * every frontend pull request and again weekly against production, asserting
 * LCP, CLS and TBT directly — and the API and database had no request timing,
 * no metrics, no slow-query log and no latency budget at all. So the half of
 * the system that will fall over first was the half with no instrumentation,
 * and the only way to learn that an endpoint had become slow was for somebody
 * to notice on their phone.
 *
 * ── What it deliberately does NOT record ────────────────────────────────
 *
 * 🔴 POPIA s.10, minimality. A timing log is the easiest place in a codebase
 * to accidentally build a surveillance record, so this one records the SHAPE
 * of a request and nothing that identifies who made it or what they asked
 * about:
 *
 *   · the route TEMPLATE, never the resolved path. `/api/rooms/:id`, not the
 *     room's id — otherwise the log says which rooms a visitor looked at,
 *     which is exactly what room_view_days was designed NOT to store.
 *   · no query string. `?search=rooms+near+Tembisa` is what somebody typed.
 *   · no request body, no headers, no cookies, no IP address, no user id.
 *
 * What is left is "POST /api/auth/login took 2140 ms and answered 201", which
 * is what a performance question actually needs.
 *
 * ── Why a middleware and not an interceptor ─────────────────────────────
 *
 * An interceptor starts timing after the guards and pipes have run, so it
 * cannot see time spent in authentication — and bcrypt in a guard is precisely
 * the kind of cost worth seeing. `res.on('finish')` measures the request as
 * the person experienced it, up to the last byte handed to the socket.
 */
@Injectable()
export class RequestTimingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('RequestTiming');

  /**
   * Read once, at construction. The threshold is an operator's choice per
   * environment and changing it is a restart, which is the right granularity:
   * re-reading process.env on every request would put a lookup on the hot
   * path to support a change nobody makes at runtime.
   */
  private readonly slowMs = parseInt(process.env.SLOW_REQUEST_MS ?? '0', 10);

  use(req: Request, res: Response, next: NextFunction): void {
    // Zero means off, and off is the default outside development. A log line
    // per slow request is cheap; a log line per request is a bill.
    if (this.slowMs <= 0) return next();

    const started = process.hrtime.bigint();

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (ms < this.slowMs) return;

      const where = routeTemplate(req);
      const line = `${req.method} ${where} ${res.statusCode} ${ms.toFixed(0)}ms`;
      // warn, not log: the threshold means somebody chose this as "too slow",
      // so it belongs where a log aggregator would pick it up.
      this.logger.warn(line);
    });

    next();
  }
}

/**
 * The route as the router knows it, with any resolved id put back.
 *
 * Express fills `req.route` during dispatch, so by `finish` it is there for
 * anything that matched a handler. A 404 never matched one, which is why the
 * fallback redacts by shape instead of returning the raw path — a 404 on
 * `/api/rooms/<uuid>` must not log the uuid either.
 */
export function routeTemplate(req: Pick<Request, 'baseUrl' | 'route' | 'path'>): string {
  const route = (req as { route?: { path?: string } }).route?.path;
  if (route) {
    const base = req.baseUrl ?? '';
    const joined = `${base}${route === '/' ? '' : route}`;
    return joined || '/';
  }
  return redactPath(req.path ?? '');
}

/** Replace anything that looks like an identifier with its placeholder. */
export function redactPath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      // uuid
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
      // cuid / cuid2 — what Prisma's @default(cuid()) produces
      if (/^c[a-z0-9]{20,}$/i.test(seg)) return ':id';
      // a bare number
      if (/^\d+$/.test(seg)) return ':n';
      // a long opaque token: anything mostly hex or base64url and long enough
      // to be a secret rather than a word.
      if (seg.length >= 24 && /^[A-Za-z0-9_-]+$/.test(seg) && !/^[a-z-]+$/i.test(seg)) return ':token';
      return seg;
    })
    .join('/');
}
