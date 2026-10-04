import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

const KEY_PREFIX = 'rb_saved_rooms';
/** Saves made before signing in, migrated to the account on login. */
const ANON_KEY = `${KEY_PREFIX}:anon`;

/**
 * Saved rooms — the ♡ button on each room card.
 *
 * SCOPED PER USER. An earlier version used a single global key, which meant
 * that on a shared device a landlord signing in after a tenant saw the
 * tenant's saved rooms. That is a personal-information leak under POPIA, not
 * merely a display bug, so storage is now keyed by user id and the in-memory
 * set is swapped whenever the signed-in user changes.
 *
 * PERSISTENCE: still device-local, and this note was out of date.
 *
 * ⚠️ There IS a `saved_rooms` table in the schema, and **nothing writes to
 * it** — no create, no upsert, not one reference in the backend. It is read in
 * two places and deleted from in one. So the schema says the feature is
 * server-side and the feature is not, which is the same family of defect as a
 * `documentDeletedAt` that deleted nothing: the next person to read the model
 * will believe it. Recorded in docs/OUTSTANDING.md rather than fixed here,
 * because promoting this is a create endpoint plus a migration of everybody's
 * device-local saves, not a line.
 *
 * It matters for account deletion (Phase 7g): a person's real saved rooms are
 * on their device, so closing the account cannot erase them server-side. The
 * close-account screen therefore clears this bucket itself, and says so.
 */
@Injectable({ providedIn: 'root' })
export class SavedRoomsService {
  private auth = inject(AuthService);
  private readonly _ids = signal<string[]>([]);

  readonly ids = this._ids.asReadonly();
  readonly count = computed(() => this._ids().length);

  constructor() {
    // One-off cleanup: the pre-fix build stored every user's saves under a
    // single global key. Remove it so nobody inherits another account's data.
    this.remove(KEY_PREFIX);

    // Re-read from the correct bucket whenever the signed-in user changes,
    // including logout (which falls back to the anonymous bucket).
    effect(() => {
      const userId = this.auth.user()?.id ?? null;
      this.migrateAnonymousSaves(userId);
      this._ids.set(this.load(this.keyFor(userId)));
    });
  }

  isSaved(roomId: string): boolean {
    return this._ids().includes(roomId);
  }

  /** Returns the new saved state, so callers can react without re-reading. */
  toggle(roomId: string): boolean {
    const saved = this.isSaved(roomId);
    this._ids.update((ids) => (saved ? ids.filter((id) => id !== roomId) : [...ids, roomId]));
    this.persist();
    return !saved;
  }

  /**
   * Removes a room regardless of current state.
   *
   * toggle() would re-save a room that had already been dropped, which is
   * exactly what happens when the dashboard prunes a listing that 404s.
   */
  unsave(roomId: string) {
    if (!this.isSaved(roomId)) return;
    this._ids.update((ids) => ids.filter((id) => id !== roomId));
    this.persist();
  }

  clear() {
    this._ids.set([]);
    this.persist();
  }

  /**
   * Wipe every bucket on this device — Phase 7g.
   *
   * For account deletion. The saves live in localStorage, so the server cannot
   * reach them: if this were not called, somebody who closed their account
   * would hand the next person to pick up the phone a list of the rooms they
   * had been looking at. That is personal information about a person who has
   * asked to be forgotten, left behind by the one action that promised to
   * forget them.
   *
   * Every key, not just the current user's: the point is that nothing of
   * theirs is left on the device, and the anonymous bucket may hold saves they
   * made before signing up.
   */
  clearDevice() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
      }
    } catch {
      /* storage unavailable — there is nothing stored to clear */
    }
    this._ids.set([]);
  }

  private keyFor(userId: string | null): string {
    return userId ? `${KEY_PREFIX}:${userId}` : ANON_KEY;
  }

  /**
   * Rooms saved while logged out are moved onto the account on first sign-in,
   * so browsing anonymously then registering does not silently lose them.
   */
  private migrateAnonymousSaves(userId: string | null) {
    if (!userId) return;
    const anon = this.load(ANON_KEY);
    if (anon.length === 0) return;

    const key = this.keyFor(userId);
    const merged = Array.from(new Set([...this.load(key), ...anon]));
    this.write(key, merged);
    this.remove(ANON_KEY);
  }

  private persist() {
    this.write(this.keyFor(this.auth.user()?.id ?? null), this._ids());
  }

  private load(key: string): string[] {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];   // SSR, or storage disabled
    }
  }

  private write(key: string, ids: string[]) {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      /* storage unavailable — saves stay in memory for this session */
    }
  }

  private remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* no-op */
    }
  }
}
