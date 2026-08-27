import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

export type ReportReason =
  | 'not_a_real_listing'
  | 'agent_posing_as_landlord'
  | 'upfront_payment_demanded'
  | 'discriminatory'
  | 'misleading_details'
  | 'harassment'
  | 'already_let'
  | 'other';

export interface CreateReportPayload {
  roomId?: string;
  reportedUserId?: string;
  reason: ReportReason;
  details: string;
  contactEmail?: string;
}

/** Wording shown to reporters. Plain language, no jargon. */
export const REPORT_REASON_LABELS: { value: ReportReason; label: string }[] = [
  { value: 'upfront_payment_demanded', label: 'They asked for money before I viewed the room' },
  { value: 'not_a_real_listing', label: "The room doesn't exist, or the photos are stolen" },
  { value: 'agent_posing_as_landlord', label: 'An agent is pretending to be the landlord' },
  { value: 'misleading_details', label: 'The price, size or condition is wrong' },
  { value: 'discriminatory', label: 'The listing or landlord is discriminating' },
  { value: 'already_let', label: 'The room is already let but still advertised' },
  { value: 'harassment', label: 'I am being harassed' },
  { value: 'other', label: 'Something else' },
];

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Works signed out; contactEmail is required in that case. */
  submit(payload: CreateReportPayload) {
    return this.http.post<{ id: string; message: string }>(`${this.api}/reports`, payload);
  }

  listForAdmin(status?: string) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<any[]>(`${this.api}/reports${query}`);
  }

  context(id: string) {
    return this.http.get<{ priorReportsOnRoom: number; priorReportsOnUser: number }>(
      `${this.api}/reports/${id}/context`,
    );
  }

  resolve(id: string, status: 'investigating' | 'actioned' | 'dismissed', resolutionNote?: string) {
    return this.http.patch(`${this.api}/reports/${id}/resolve`, { status, resolutionNote });
  }
}
