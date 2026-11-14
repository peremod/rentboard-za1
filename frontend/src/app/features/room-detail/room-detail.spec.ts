import { describe, it, expect } from 'vitest';
import { signal } from '@angular/core';
import { Subject, throwError, of } from 'rxjs';
import { RoomDetail } from './room-detail';

/**
 * The in-flight guard on "Apply free →".
 *
 * ── Why this exists
 *
 * `duplicate-submission-drive.mjs` proves the OUTCOME — a double tap at thumb
 * speed produces one application — but it could not isolate the mechanism, and
 * the drive says so. Removing `[disabled]="applying()"` from the template and
 * rebuilding changed nothing at thumb speed, measured three ways, because the
 * label becomes "Sending…" and a re-queried button no longer matches. So the
 * browser cannot tell us whether the `applying` signal does its job.
 *
 * This can. `apply()` is exercised directly, the way
 * `tenant-dashboard.spec.ts` exercises `activeApplications()`: the method
 * reads `applicationsService`, `surveys` and four of its own signals and
 * nothing else, so rendering the component would add a page of TestBed setup
 * for a component that also wants routing, SEO and eight services — and would
 * test the same ten lines.
 *
 * ── ⚠️ What this does NOT cover, said plainly
 *
 * That the TEMPLATE binds `[disabled]` to `applying()`. A signal nothing binds
 * is a control that only looks like a control, which is the family this
 * repository keeps finding, and neither this spec nor the drive closes that
 * gap: the drive cannot see the binding and this spec never renders. What is
 * covered is the half the binding depends on — that the signal is true for
 * exactly as long as the request is in flight, and false again on both
 * outcomes. If it were stuck true, a landlord's second application would be
 * refused for ever; if it never went true, the binding would have nothing to
 * act on.
 */
describe('RoomDetail — the apply button while the request is in flight', () => {
  /**
   * The parts of the component `apply()` touches, and nothing else. Built
   * fresh per test so one case cannot leave state for the next.
   */
  const make = (applyImpl: () => unknown) => {
    const c = Object.create(RoomDetail.prototype) as Record<string, unknown> & {
      apply: (roomId: string) => void;
    };
    c['applying'] = signal(false);
    c['applied'] = signal(false);
    c['applyError'] = signal<string | null>(null);
    c['coverNote'] = '';
    c['applicationsService'] = { apply: applyImpl };
    c['surveys'] = { load: () => of(null) };
    return c as typeof c & {
      applying: () => boolean;
      applied: () => boolean;
      applyError: () => string | null;
    };
  };

  it('is busy from the moment it is pressed until the answer arrives', () => {
    /**
     * A Subject rather than `of(...)`: `of` completes synchronously, so the
     * request would be finished before the assertion and the window this
     * guard exists for would never be observable. The whole point is the gap
     * between the tap and the answer.
     */
    const answer = new Subject<unknown>();
    const c = make(() => answer);

    expect(c.applying()).toBe(false);

    c.apply('room-1');
    expect(c.applying()).toBe(true);     // the window a second tap falls into
    expect(c.applied()).toBe(false);

    answer.next({ id: 'app-1' });
    answer.complete();
    expect(c.applying()).toBe(false);
    expect(c.applied()).toBe(true);
  });

  it('stops being busy when the request fails, so they can try again', () => {
    /**
     * ⚠️ The failure path matters more than the success one. A guard left
     * stuck true after an error is a button that never comes back — on a cheap
     * Android with a connection that drops for a second, that is a landlord
     * who cannot apply at all until they reload the page.
     */
    const c = make(() => throwError(() => ({ error: { message: 'Nope' } })));

    c.apply('room-1');
    expect(c.applying()).toBe(false);
    expect(c.applied()).toBe(false);
    expect(c.applyError()).toBe('Nope');
  });

  it('says something of its own when the server explains nothing', () => {
    const c = make(() => throwError(() => ({})));
    c.apply('room-1');
    expect(c.applying()).toBe(false);
    expect(c.applyError()).toBe('Could not send your application. Please try again.');
  });

  it('clears a previous error when they press it again', () => {
    /**
     * Otherwise a failure then a success leaves the old refusal on screen
     * under a form that has just worked.
     */
    const answer = new Subject<unknown>();
    const c = make(() => answer);
    c['applyError'] = signal<string | null>('an earlier refusal') as unknown as never;

    c.apply('room-1');
    expect(c.applyError()).toBeNull();

    answer.next({ id: 'app-1' });
    answer.complete();
    expect(c.applyError()).toBeNull();
    expect(c.applied()).toBe(true);
  });
});
