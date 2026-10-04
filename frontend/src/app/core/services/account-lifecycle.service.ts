import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { inlineErrors } from '../interceptors/inline-errors';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

/** What ending the account will erase, and what it will keep. */
export interface DeletionPreview {
  erased: { label: string; count: number | null }[];
  kept: { label: string; count: number; why: string }[];
  stops: string[];
}

@Injectable({ providedIn: 'root' })
export class AccountLifecycleService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Put it to sleep. Reversible; nothing is destroyed. */
  deactivate(): Observable<{ deactivatedAt: string; roomsPaused: number }> {
    return this.http.post<{ deactivatedAt: string; roomsPaused: number }>(
      `${this.api}/account/deactivate`, {},
    );
  }

  reactivate(): Observable<{ deactivatedAt: null; roomsStillPaused: number }> {
    return this.http.post<{ deactivatedAt: null; roomsStillPaused: number }>(
      `${this.api}/account/reactivate`, {},
    );
  }

  /**
   * Counted from the person's own rows, so the screen can tell a landlord with
   * a live tenancy something different from a tenant who applied for one room.
   */
  deletionPreview(): Observable<DeletionPreview> {
    return this.http.get<DeletionPreview>(`${this.api}/account/deletion-preview`);
  }

  /**
   * The end. Needs the password, the typed word, and the acknowledgement.
   *
   * INLINE_ERRORS: the screen shows the refusal under the password field and
   * keeps what was typed. A dialog over it would also mean dismissing a modal
   * before you could see which field was wrong.
   */
  deleteAccount(body: { password?: string; confirm: 'DELETE'; understood: true }) {
    return this.http.delete<{ deletedAt: string }>(
      `${this.api}/account`, { body, context: inlineErrors() },
    );
  }
}
