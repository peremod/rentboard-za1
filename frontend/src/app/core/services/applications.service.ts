import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import {
  Application, ApplicantInbox, ApplicantInboxFilters,
} from '../models/application.model';

@Injectable({ providedIn: 'root' })
export class ApplicationsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  apply(roomId: string, coverNote?: string): Observable<Application> {
    return this.http.post<Application>(`${this.api}/applications`, { roomId, coverNote });
  }

  getMyApplications(): Observable<Application[]> {
    return this.http.get<Application[]>(`${this.api}/applications/mine`);
  }

  // ── Landlord: applicant manager ──
  /**
   * Every applicant across everything this landlord lets — Phase 7c.
   *
   * `getRoomApplications` below is per room, which meant a landlord with six
   * rooms had six screens to check before they knew whether anybody had
   * applied. Empty filter keys are dropped rather than sent as `undefined`:
   * `HttpParams` would serialise them as `roomId=undefined`, and the server's
   * `@IsUUID()` would answer 400 to a request that meant "no filter".
   */
  inbox(filters: ApplicantInboxFilters = {}): Observable<ApplicantInbox> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value) params[key] = value;
    }
    return this.http.get<ApplicantInbox>(`${this.api}/applications/inbox`, { params });
  }

  getRoomApplications(roomId: string): Observable<Application[]> {
    return this.http.get<Application[]>(`${this.api}/applications/room/${roomId}`);
  }

  markViewed(applicationId: string): Observable<Application> {
    return this.http.post<Application>(`${this.api}/applications/${applicationId}/view`, {});
  }

  /** Tenant withdraws their own application. Not available once accepted. */
  withdraw(id: string) {
    return this.http.post<Application>(`${this.api}/applications/${id}/withdraw`, {});
  }

  /** Reverses an acceptance. Only valid within 30 minutes. */
  undoAccept(id: string) {
    return this.http.post<{ undone: boolean; reinstated: number; message: string }>(
      `${this.api}/applications/${id}/undo-accept`, {},
    );
  }

  unshortlist(id: string) {
    return this.http.post<Application>(`${this.api}/applications/${id}/unshortlist`, {});
  }

  shortlist(applicationId: string): Observable<Application> {
    return this.http.post<Application>(`${this.api}/applications/${applicationId}/shortlist`, {});
  }

  accept(applicationId: string): Observable<Application> {
    return this.http.post<Application>(`${this.api}/applications/${applicationId}/accept`, {});
  }

  reject(applicationId: string, reason?: string): Observable<Application> {
    return this.http.post<Application>(`${this.api}/applications/${applicationId}/reject`, { reason });
  }
}
