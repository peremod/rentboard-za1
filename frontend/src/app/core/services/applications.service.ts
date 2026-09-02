import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { Application } from '../models/application.model';

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
