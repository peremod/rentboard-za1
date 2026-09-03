import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/** Don't write more than once an hour per user. */
const WRITE_EVERY_MS = 60 * 60 * 1000;

/**
 * Records that a user was active, at most once an hour.
 *
 * Deliberately a single overwritten timestamp rather than an event log: it
 * answers "how many people used the app this week" without recording what
 * anyone did, when, or in what order. There is nothing here to reconstruct a
 * session from.
 *
 * The in-memory cache keeps this off the hot path — without it every
 * authenticated request would carry a write.
 */
@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
  /** userId -> last write. Lost on restart, which only costs one extra write. */
  private readonly recent = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request?.user?.id;

    if (userId) {
      const now = Date.now();
      const last = this.recent.get(userId) ?? 0;

      if (now - last > WRITE_EVERY_MS) {
        this.recent.set(userId, now);

        // Fire-and-forget. A metrics write must never delay or fail a request.
        this.prisma.user
          .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
          .catch(() => {});

        // Bound the map so a long-running process cannot grow it without limit.
        if (this.recent.size > 10_000) {
          const cutoff = now - WRITE_EVERY_MS;
          for (const [id, seen] of this.recent) {
            if (seen < cutoff) this.recent.delete(id);
          }
        }
      }
    }

    return next.handle();
  }
}
