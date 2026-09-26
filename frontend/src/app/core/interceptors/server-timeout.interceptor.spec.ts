import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { serverTimeoutInterceptor } from './server-timeout.interceptor';
import { environment } from '@env/environment';

/**
 * This exists because of a build failure, not a code review.
 *
 * Every production build between v1.73.0 and v1.75.1 failed on a GitHub
 * runner, and the error named none of the cause: "An error occurred while
 * prerendering route '/af'", then "Terminating worker thread" for five more
 * routes. Underneath it, the board's listing request to the production API
 * host — which resolves on a runner to something that accepts the connection
 * and never replies — never settled, so the home page never became stable and
 * @angular/build's 30-second abort took the whole build down.
 *
 * A hang is the one failure a request can have that no error handler sees. So
 * the property worth asserting is not "the interceptor is wired up" but "a
 * server-side request cannot wait forever, and what it raises is a status the
 * components already handle". Fake timers, because a test that really waits
 * eight seconds is a test someone deletes.
 */
describe('serverTimeoutInterceptor', () => {
  const url = `${environment.apiUrl}/rooms`;

  const setup = (platform: 'server' | 'browser') => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        provideHttpClient(withInterceptors([serverTimeoutInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    return {
      http: TestBed.inject(HttpClient),
      backend: TestBed.inject(HttpTestingController),
    };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('fails a server-side request the API never answers', async () => {
    const { http, backend } = setup('server');
    let error: HttpErrorResponse | undefined;

    http.get(url).subscribe({ error: (e: HttpErrorResponse) => (error = e) });
    backend.expectOne(url); // opened, and deliberately never flushed

    await vi.advanceTimersByTimeAsync(7_900);
    expect(error, 'gave up before the ceiling').toBeUndefined();

    await vi.advanceTimersByTimeAsync(200);
    expect(error).toBeInstanceOf(HttpErrorResponse);
    // 504 and not a bare TimeoutError: room-detail answers 503 with
    // Retry-After for any non-404 failure, and 404 would ask Google to drop a
    // room that exists. A timeout has to land on that same branch.
    expect(error?.status).toBe(504);
  });

  it('leaves a browser request alone — a slow phone is not a failure', async () => {
    const { http, backend } = setup('browser');
    let settled = false;

    http.get(url).subscribe({ next: () => (settled = true), error: () => (settled = true) });
    const req = backend.expectOne(url);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled, 'a browser request was cut off by the server ceiling').toBe(false);

    req.flush({ data: [] });
    expect(settled).toBe(true);
  });

  it('does not put a ceiling on requests to anything but our own API', async () => {
    const { http, backend } = setup('server');
    let settled = false;

    // ImageKit, a webhook, a font — not ours to time out, and cutting one off
    // at eight seconds would be a failure we invented.
    http.get('https://ik.imagekit.io/whatever').subscribe({
      next: () => (settled = true),
      error: () => (settled = true),
    });
    const req = backend.expectOne('https://ik.imagekit.io/whatever');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);

    req.flush({});
    expect(settled).toBe(true);
  });
});
