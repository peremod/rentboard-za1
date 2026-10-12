import type { ApplicationStatus } from './application.model';
import type { TenancyStatus } from './tenancy.model';

/**
 * The state vocabulary — five meanings, mapped once.
 *
 * ── Why this is a model and not a method on each component
 *
 * The treatment is defined once in `styles.scss` (audit §H4). That stops the
 * CSS being written five times; it does not stop five components disagreeing
 * about which meaning a given `status` has. `.status--accepted` and
 * `.status--rejected` were declared identically in BOTH `applicants.ts` and
 * `applicants-inbox.ts`, with raw hexes, and the inbox quietly folded
 * `withdrawn` in with `rejected` while the other screen did not. Two copies of
 * a mapping is the same defect as two copies of a rule, one level up.
 *
 * So the mapping is a pure function, imported where it is needed, and a new
 * status added to either union is a TYPE ERROR here rather than a chip that
 * silently falls back to the unmodified grey.
 */
export type StateName = 'live' | 'waiting' | 'past' | 'closed' | 'disputed';

/** Every name the vocabulary defines. Exported so a drive can assert the set. */
export const STATE_NAMES: readonly StateName[] = ['live', 'waiting', 'past', 'closed', 'disputed'];

/** The class pair a template writes: `class="state" [class]="stateClass(...)"`. */
export const stateClass = (s: StateName): string => `state--${s}`;

/**
 * An application's state.
 *
 * ⚠️ `viewed` is `waiting`, not `live`. The landlord has opened it and done
 * nothing else, so the person is still waiting on them — which is the whole
 * point of distinguishing `waiting` from the rest: it is the only state that
 * asks somebody for something.
 *
 * `withdrawn` is `closed` and not `disputed`. The applicant stopped; nobody is
 * contesting anything. The inbox's old rule painted it the same red as
 * `rejected`, which reads as a refusal the landlord made.
 */
export function applicationState(status: ApplicationStatus): StateName {
  switch (status) {
    case 'accepted':
      return 'live';
    case 'pending':
    case 'viewed':
    case 'shortlisted':
      return 'waiting';
    case 'rejected':
    case 'withdrawn':
      return 'closed';
  }
}

/**
 * A tenancy's state.
 *
 * ⚠️ `cancelled` is `closed`, not `past`. A letting that never started is a
 * different KIND of record, not a lesser one — the archive says "Never
 * started" rather than fading "Past letting", and the colour follows the word.
 */
export function tenancyState(status: TenancyStatus): StateName {
  switch (status) {
    case 'active':
      return 'live';
    case 'pending':
      return 'waiting';
    case 'ended':
      return 'past';
    case 'cancelled':
      return 'closed';
  }
}
