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
 * PERSISTENCE: still device-local. There is no SavedRoom model in the schema
 * and no endpoint behind it, so saves do not follow a user across devices.
 * Promoting this to the backend is a join table plus two routes.
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
