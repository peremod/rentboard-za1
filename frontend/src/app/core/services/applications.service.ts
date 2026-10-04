import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import {
  Application, ApplicantInbox, ApplicantInboxFilters,
} from '../models/application.model';


/**
 * A viewing arranged on an application — Phase 7l.
 *
 * There was no such thing before: `ApplicationStatus`'s `viewed` means the
 * LANDLORD opened the application, not that anybody saw the room.
 */
export interface RoomViewing {
  id: string;
  startsAt: string;
  /** Typed by the landlord for this viewing. Never their stored property address. */
  meetingPlace: string;
  note?: string | null;
  status: 'proposed' | 'accepted' | 'declined' | 'cancelled';
  respondedAt?: string | null;
  declineReason?: string | null;
  cancelledAt?: string | null;
  cancelledById?: string | null;
}

/** The tenant's upcoming list, which names the room so three applications stay apart. */
export interface UpcomingViewing {
  id: string;
  startsAt: string;
  meetingPlace: string;
  note?: string | null;
  status: 'proposed' | 'accepted';
  application: { id: string; room: { id: string; title: string; locationDisplay: string } };
}

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

  // ── Viewings — Phase 7l ──────────────────────────────────────────────────

  /**
   * Invite this applicant to come and see the room.
   *
   * ⚠️ `meetingPlace` is typed by the landlord and IS sent to the applicant.
   * There is deliberately no option to use the property's stored address: the
   * form where that was typed promises "Only you see this. It is never on a
   * listing and never sent to an applicant", and a convenience here would break
   * that on the landlord's behalf without their knowing.
   */
  inviteToViewing(applicationId: string, body: { startsAt: string; meetingPlace: string; note?: string }) {
    return this.http.post<RoomViewing>(`${this.api}/applications/${applicationId}/viewings`, body);
  }

  viewingsFor(applicationId: string) {
    return this.http.get<RoomViewing[]>(`${this.api}/applications/${applicationId}/viewings`);
  }

  /** The tenant answers. Only the tenant may — the server enforces it. */
  respondToViewing(viewingId: string, accept: boolean, declineReason?: string) {
    return this.http.post<RoomViewing>(
      `${this.api}/applications/viewings/${viewingId}/respond`, { accept, declineReason },
    );
  }

  /** Either side calls it off. */
  cancelViewing(viewingId: string) {
    return this.http.post<RoomViewing>(`${this.api}/applications/viewings/${viewingId}/cancel`, {});
  }

  /** What this tenant has coming up, across every application. */
  myViewings() {
    return this.http.get<UpcomingViewing[]>(`${this.api}/applications/viewings/mine`);
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
