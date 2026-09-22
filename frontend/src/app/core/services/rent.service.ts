import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

/** What a month of rent can be. `waived` means the landlord is not chasing it. */
export type RentStatus = 'unpaid' | 'paid' | 'partial' | 'waived';

/**
 * One month of rent against one tenancy.
 *
 * Both sides of the record are present at once, on purpose. `status` is what
 * the landlord marked; `tenantDisputedAt` and `tenantNote` are the tenant's
 * answer, and the answer sits BESIDE the mark rather than replacing it.
 * Mastande does not know whether money arrived and does not claim to — see
 * README §23.
 */
export interface RentPeriod {
  id: string;
  tenancyId: string;
  /** First of the month, midnight UTC. */
  periodStart: string;
  status: RentStatus;
  amountCents: number;
  markedAt?: string | null;
  tenantDisputedAt?: string | null;
  tenantNote?: string | null;
  reminderSentAt?: string | null;
}

@Injectable({ providedIn: 'root' })
export class RentService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Either party may read their own tenancy's history. */
  history(tenancyId: string) {
    return this.http.get<RentPeriod[]>(`${this.api}/properties/rent/${tenancyId}`);
  }

  /**
   * The tenant's answer to a month marked unpaid.
   *
   * The note is optional because being able to disagree matters more than
   * being able to explain. Recording it also stops further reminders for that
   * month: continuing to chase someone who has said they paid is how a
   * reminder becomes harassment.
   */
  dispute(periodId: string, note?: string) {
    return this.http.patch<RentPeriod>(
      `${this.api}/properties/rent/period/${periodId}/dispute`,
      note ? { note } : {},
    );
  }
}
