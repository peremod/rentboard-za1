import { Injectable, signal, computed } from '@angular/core';

const STORAGE_KEY = 'rb_saved_rooms';

/**
 * Saved rooms — the heart button on each room card.
 *
 * PERSISTENCE: device-local (localStorage), not server-side. There is no
 * SavedRoom model in the Prisma schema and no endpoint behind it, so saves
 * do not follow a user across devices or survive clearing site data.
 * Promoting this to the backend is a small change (join table + two routes)
 * and is tracked in the README follow-ups.
 *
 * Reads are guarded because this service is constructed during SSR, where
 * localStorage does not exist.
 */
@Injectable({ providedIn: 'root' })
export class SavedRoomsService {
  private readonly _ids = signal<string[]>(this.load());

  readonly ids = this._ids.asReadonly();
  readonly count = computed(() => this._ids().length);

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

  clear() {
    this._ids.set([]);
    this.persist();
  }

  private load(): string[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];   // SSR, or storage disabled
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._ids()));
    } catch {
      /* storage unavailable — saves stay in memory for this session */
    }
  }
}
