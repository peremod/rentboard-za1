import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { SavedSearch, SaveSearchPayload } from '../models/alerts.model';

@Injectable({ providedIn: 'root' })
export class AlertsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly searches = signal<SavedSearch[]>([]);

  load() {
    return this.http
      .get<SavedSearch[]>(`${this.api}/alerts/saved-searches`)
      .pipe(tap((list) => this.searches.set(list)));
  }

  create(payload: SaveSearchPayload) {
    return this.http
      .post<SavedSearch>(`${this.api}/alerts/saved-searches`, payload)
      .pipe(tap((created) => this.searches.update((l) => [created, ...l])));
  }

  update(id: string, payload: Partial<SaveSearchPayload>) {
    return this.http
      .patch<SavedSearch>(`${this.api}/alerts/saved-searches/${id}`, payload)
      .pipe(tap((updated) => this.searches.update((l) => l.map((s) => (s.id === id ? updated : s)))));
  }

  /** Pausing keeps the search; consent can be withdrawn without losing setup. */
  togglePaused(search: SavedSearch) {
    return this.update(search.id, { isActive: !search.isActive });
  }

  remove(id: string) {
    return this.http
      .delete<{ deleted: boolean }>(`${this.api}/alerts/saved-searches/${id}`)
      .pipe(tap(() => this.searches.update((l) => l.filter((s) => s.id !== id))));
  }
}
