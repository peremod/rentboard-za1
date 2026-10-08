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

/**
 * The tenancy a ledger belongs to, as the rent endpoint returns it.
 *
 * ⚠️ This arrives WITH the periods, and that is the point. The endpoint used
 * to answer a bare `RentPeriod[]`, so a screen holding a rent ledger had no
 * way to know whether the letting behind it was running, waiting on a
 * move-in, or finished two years ago — and the tenant's rent screen duly
 * rendered an ended tenancy as a current one. A record whose state you have
 * to guess gets described wrongly.
 */
export interface RentLedgerTenancy {
  id: string;
  status: 'pending' | 'active' | 'ended' | 'cancelled';
  startDate: string | null;
  endDate: string | null;
  rentCents: number;
  reviewsCloseAt: string | null;
}

/** What `GET /properties/rent/:tenancyId` answers. */
export interface RentLedger {
  tenancy: RentLedgerTenancy;
  periods: RentPeriod[];
}

@Injectable({ providedIn: 'root' })
export class RentService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Either party may read their own tenancy's history. */
  history(tenancyId: string) {
    return this.http.get<RentLedger>(`${this.api}/properties/rent/${tenancyId}`);
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
