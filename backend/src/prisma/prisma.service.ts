import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Wraps PrismaClient as a NestJS injectable service.
 * Connects on module init, disconnects gracefully on shutdown.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly queryLogger = new Logger('SlowQuery');

  /**
   * How slow a single statement has to be before it is logged, in ms.
   * Zero switches the query log off, which is the default in production —
   * see configuration.ts for why that is a cost decision and not a shrug.
   */
  private readonly slowQueryMs = Number(process.env.SLOW_QUERY_MS ?? 0);

  constructor() {
    super({
      /**
       * 🔴 These were `emit: 'event'` with NOTHING SUBSCRIBED.
       *
       * Prisma's `emit: 'event'` means "do not print this, hand it to a
       * listener" — and no `$on` call existed anywhere in src/. So every
       * database warning and every database error this client produced from
       * the day it was written went to a listener that was never registered,
       * which is to say nowhere. The log config read like a deliberate choice
       * about verbosity and was in fact a channel nobody could hear: the same
       * shape as the Message.readAt nobody wrote and the nineteen @Throttle
       * decorators with no guard.
       *
       * They are still events — printing them directly would lose the Nest
       * logger's formatting and prefixes — but now something listens. See
       * subscribe() below.
       */
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
        // The query stream is what the slow-query log reads. Subscribing to it
        // is cheap; what is NOT cheap is logging every line, so the listener
        // filters by duration and the threshold defaults to off.
        { emit: 'event', level: 'query' },
      ],
    });

    this.subscribe();
  }

  private subscribe(): void {
    // The casts are Prisma's own doing: $on's event names are typed from the
    // log array, which TypeScript cannot narrow from a literal in super().
    const client = this as unknown as {
      $on: (e: 'warn' | 'error' | 'query', cb: (ev: never) => void) => void;
    };

    client.$on('warn', (e: never) => {
      this.logger.warn((e as Prisma.LogEvent).message);
    });
    client.$on('error', (e: never) => {
      this.logger.error((e as Prisma.LogEvent).message);
    });

    if (this.slowQueryMs > 0) {
      client.$on('query', (e: never) => {
        const ev = e as Prisma.QueryEvent;
        if (ev.duration < this.slowQueryMs) return;
        /**
         * 🔴 ev.params IS NEVER LOGGED. POPIA s.10 again, and this one is
         * sharper than the request log: the parameters of a real query hold
         * email addresses, phone numbers, password hashes, document paths and
         * one-time codes. Prisma offers them on this event and the obvious
         * thing to write is `${ev.query} ${ev.params}`, which would quietly
         * turn the application log into a copy of the user table.
         *
         * The statement text alone says which query is slow, which is the
         * whole question. The values do not help and cannot be unspilled.
         */
        this.queryLogger.warn(`${ev.duration}ms ${collapse(ev.query)}`);
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
    if (this.slowQueryMs > 0) {
      this.logger.log(`Slow-query log on: statements over ${this.slowQueryMs}ms`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Used by GET /health */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * One line, and short enough to read in a log.
 *
 * A Prisma-generated SELECT across a table with 34 columns and a joined
 * relation runs to several hundred characters, and a log nobody can scan is
 * a log nobody reads. The head of the statement is what identifies it.
 */
export function collapse(sql: string, max = 300): string {
  const one = sql.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}
