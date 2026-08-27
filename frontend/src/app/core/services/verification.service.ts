import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { VerificationRequest, VerificationType } from '../models/verification.model';

@Injectable({ providedIn: 'root' })
export class VerificationService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly requests = signal<VerificationRequest[]>([]);

  /** Drives the badge: only an approved identity check counts as verified. */
  readonly isIdentityVerified = computed(() =>
    this.requests().some((r) => r.type === 'identity' && r.status === 'approved'),
  );

  readonly hasPending = computed(() => this.requests().some((r) => r.status === 'pending'));

  load() {
    return this.http
      .get<VerificationRequest[]>(`${this.api}/verification/mine`)
      .pipe(tap((list) => this.requests.set(list)));
  }

  submit(type: VerificationType, documentPath: string) {
    return this.http
      .post<VerificationRequest>(`${this.api}/verification`, { type, documentPath })
      .pipe(tap((created) => this.requests.update((l) => [created, ...l])));
  }
}
