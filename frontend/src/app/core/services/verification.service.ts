import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import {
  BadgeBasis, LandlordReferenceSummary, ReferenceRequestView,
  VerificationEvent, VerificationRequest, VerificationType, VerificationTypeInfo,
} from '../models/verification.model';

/** What a tenant fills in when naming a previous landlord. */
export interface ReferenceSubmission {
  refereeName: string;
  refereePhone: string;
  propertyDescription?: string;
  tenancyStartedAt?: string;
  tenancyEndedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class VerificationService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly requests = signal<VerificationRequest[]>([]);
  /** The checks this account may submit — the API decides, by role. */
  readonly types = signal<VerificationTypeInfo[]>([]);

  /** Drives the landlord badge: only an approved identity check counts. */
  readonly isIdentityVerified = computed(() =>
    this.requests().some((r) => r.type === 'identity' && r.status === 'approved'),
  );

  readonly hasPending = computed(() => this.requests().some((r) => r.status === 'pending'));

  /**
   * A Tenant Passport needs identity AND one income proof.
   *
   * Mirrored from VerificationService.refreshPassport on the API, which is
   * authoritative — this drives what the page shows while the server decides
   * what is true. Kept as one expression rather than two booleans so the two
   * halves cannot be read as independent.
   */
  readonly passportProgress = computed(() => {
    const approved = this.requests().filter((r) => r.status === 'approved');
    const identity = approved.some((r) => r.type === 'identity');
    const income = approved.some((r) =>
      this.types().find((t) => t.type === r.type)?.provesIncome,
    );
    return { identity, income, complete: identity && income };
  });

  load() {
    return this.http
      .get<VerificationRequest[]>(`${this.api}/verification/mine`)
      .pipe(tap((list) => this.requests.set(list)));
  }

  loadTypes() {
    return this.http
      .get<VerificationTypeInfo[]>(`${this.api}/verification/types`)
      .pipe(tap((list) => this.types.set(list)));
  }

  submit(type: VerificationType, documentPath?: string, reference?: ReferenceSubmission) {
    return this.http
      .post<VerificationRequest>(`${this.api}/verification`, { type, documentPath, reference })
      .pipe(tap((created) => this.requests.update((l) => [created, ...l])));
  }

  history(requestId: string) {
    return this.http.get<VerificationEvent[]>(`${this.api}/verification/mine/${requestId}/history`);
  }

  /**
   * What a badge rests on. Safe to show a landlord looking at an applicant:
   * the API returns passed checks only, never a rejection or an admin note.
   */
  badgeBasis(userId: string) {
    return this.http.get<BadgeBasis>(`${this.api}/verification/badge/${userId}`);
  }

  // ── The referee's side. No account, no token — the link is the auth. ──

  lookupReference(token: string) {
    return this.http.get<ReferenceRequestView>(`${this.api}/references/respond/${token}`);
  }

  respondToReference(token: string, body: { outcome: 'confirm' | 'decline'; rating?: number; comment?: string }) {
    return this.http.post<{ recorded: true }>(`${this.api}/references/respond/${token}`, body);
  }

  /** Admin: send the WhatsApp reference request for a submitted reference. */
  sendReferenceRequest(requestId: string) {
    return this.http.post<{ delivered: boolean; expiresAt: string }>(
      `${this.api}/references/${requestId}/send`, {},
    );
  }
}

export type { LandlordReferenceSummary };
