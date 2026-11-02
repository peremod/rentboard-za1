import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Home } from './home';

/**
 * The free-instance waking notice on the public board.
 *
 * The API runs on a Render free instance that suspends after ~15 minutes idle
 * and takes 30-60s to answer the first request after that. Six skeleton cards
 * for a minute are indistinguishable from a broken site, so after
 * WAKE_NOTICE_MS a first load says what is happening.
 *
 * Three things have to hold, and each of them has already been shipped wrong
 * somewhere in this codebase:
 *   1. it appears when a first load really is slow,
 *   2. it does NOT appear when the response arrives first (a notice that
 *      flashes on a 20ms warm load is worse than none),
 *   3. it never arms on the server, where a timeout is never cleared and
 *      holds the SSR render open.
 *
 * The private methods are exercised directly: they read nothing but
 * `platformId` and their own timer field, so a TestBed render would add the
 * whole board's dependency graph to test four lines.
 */
type WakeHost = {
  slowWake: { (): boolean; set(v: boolean): void };
  platformId: unknown;
  wakeTimer?: ReturnType<typeof setTimeout>;
  startWakeNotice(): void;
  clearWakeNotice(): void;
};

const host = (platformId: unknown): WakeHost => {
  const h = Object.create(Home.prototype) as WakeHost;
  h.slowWake = signal(false) as unknown as WakeHost['slowWake'];
  h.platformId = platformId;
  return h;
};

const BROWSER = 'browser';
const SERVER = 'server';

describe('Home — free-instance waking notice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays hidden before the threshold', () => {
    const h = host(BROWSER);
    h.startWakeNotice();
    vi.advanceTimersByTime(5999);
    expect(h.slowWake()).toBe(false);
  });

  it('appears once a first load passes the threshold', () => {
    const h = host(BROWSER);
    h.startWakeNotice();
    vi.advanceTimersByTime(6000);
    expect(h.slowWake()).toBe(true);
  });

  it('never appears when the rooms arrive first', () => {
    const h = host(BROWSER);
    h.startWakeNotice();
    vi.advanceTimersByTime(30);   // a warm board answers in 12-24ms
    h.clearWakeNotice();          // what the `next` handler does
    vi.advanceTimersByTime(60_000);
    expect(h.slowWake()).toBe(false);
  });

  it('never appears when the request fails either', () => {
    const h = host(BROWSER);
    h.startWakeNotice();
    h.clearWakeNotice();          // what the `error` handler does
    vi.advanceTimersByTime(60_000);
    expect(h.slowWake()).toBe(false);
  });

  it('arms no timer at all on the server', () => {
    const h = host(SERVER);
    h.startWakeNotice();
    expect(h.wakeTimer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(h.slowWake()).toBe(false);
  });

  it('re-arming a second load does not leave the first timer running', () => {
    const h = host(BROWSER);
    h.startWakeNotice();
    h.startWakeNotice();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clearing drops the timer, so navigating away leaks nothing', () => {
    const h = host(BROWSER);
    h.startWakeNotice();
    h.clearWakeNotice();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.wakeTimer).toBeUndefined();
  });
});

/**
 * ⚠️ The suite above cannot see the wiring, and that was measured, not
 * assumed: with `this.clearWakeNotice()` deleted from fetchRooms' `next`
 * handler — the live bug where a warm 20ms board shows the waking notice
 * forever — all seven cases above still passed, because each of them calls
 * clearWakeNotice() itself. A check that only exercises the helpers it also
 * calls is the shape this codebase keeps shipping.
 *
 * So these two drive the real `fetchRooms`, with the service stubbed, and
 * assert on what the handlers do rather than on what a test does.
 */
describe('Home — fetchRooms wires the notice up', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const board = (getRooms: () => Observable<unknown>) => {
    const h = Object.create(Home.prototype) as Record<string, unknown> & {
      slowWake: { (): boolean; set(v: boolean): void };
      fetchRooms(append?: boolean): void;
    };
    h['platformId'] = 'browser';
    h['roomsService'] = { getRooms };
    h['sortBy'] = 'newest';
    h['page'] = 1;
    for (const k of ['rooms', 'searchMeta', 'total', 'landlordCount', 'hasMore', 'loading', 'loadingMore']) {
      h[k] = signal<unknown>(k === 'rooms' ? [] : null);
    }
    h.slowWake = signal(false) as unknown as typeof h.slowWake;
    return h;
  };

  const response = { data: [], total: 0, hasMore: false, verifiedLandlords: 0 };

  it('a warm response leaves the notice unarmed', () => {
    const h = board(() => of(response));
    h.fetchRooms();
    vi.advanceTimersByTime(60_000);
    expect(h.slowWake()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a request that never answers raises the notice', () => {
    const h = board(() => new Observable(() => {}));
    h.fetchRooms();
    expect(h.slowWake()).toBe(false);
    vi.advanceTimersByTime(6000);
    expect(h.slowWake()).toBe(true);
  });

  it('a failing request leaves the notice unarmed', () => {
    const h = board(() => new Observable((sub) => sub.error(new Error('ENOTFOUND'))));
    h.fetchRooms();
    vi.advanceTimersByTime(60_000);
    expect(h.slowWake()).toBe(false);
  });

  it('loading more pages never arms it', () => {
    const h = board(() => new Observable(() => {}));
    h.fetchRooms(true);
    vi.advanceTimersByTime(60_000);
    expect(h.slowWake()).toBe(false);
  });
});
