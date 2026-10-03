import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import {
  Expense, ExpenseCategory, ExpenseSummary, HousemateProfile, Property,
  RelistAllResult, RentPeriod, RentStatus, UpcomingLease, YardDashboard,
} from '../models/property.model';

@Injectable({ providedIn: 'root' })
export class PropertiesService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly dashboard = signal<YardDashboard | null>(null);

  loadDashboard() {
    return this.http
      .get<YardDashboard>(`${this.api}/properties/dashboard`)
      .pipe(tap((d) => this.dashboard.set(d)));
  }

  create(body: {
    /** Private to the landlord — see Property.addressLine. */
    addressLine?: string;
    name: string; suburb?: string; city: string; province: string;
    houseRules?: string; sharedAmenities?: string[];
    currentHousemates?: number; housemateProfile?: HousemateProfile;
  }) {
    return this.http.post<Property>(`${this.api}/properties`, body);
  }

  /**
   * Partial by design — send only what changed.
   *
   * The API patches, so omitting a field leaves it alone. Sending the whole
   * object back would mean a screen that does not know about a field silently
   * clearing it, which is how the shared-living details would get wiped by the
   * rename form.
   */
  update(id: string, body: {
    /** Private to the landlord — see Property.addressLine. */
    addressLine?: string;
    name?: string; suburb?: string; city?: string; province?: string;
    houseRules?: string; sharedAmenities?: string[];
    currentHousemates?: number; housemateProfile?: HousemateProfile;
  }) {
    return this.http.patch<Property>(`${this.api}/properties/${id}`, body);
  }

  /**
   * Relist every relistable room in a yard.
   *
   * Returns what it skipped and why, not just a count — a landlord who asked
   * for six and got four needs to know which two and for what reason.
   */
  relistAll(id: string) {
    return this.http.post<RelistAllResult>(`${this.api}/properties/${id}/relist-all`, {});
  }

  /**
   * Delete a property.
   *
   * `ungroupRooms` is not a convenience flag — the API REFUSES the call while
   * rooms are attached and the caller has not passed it, and the refusal says
   * how many there are and what will happen to them. Phase 7b: never silently.
   * The confirmation dialog is what earns the true.
   */
  remove(id: string, ungroupRooms = false) {
    const query = ungroupRooms ? '?ungroupRooms=true' : '';
    return this.http.delete<{ deleted: true; roomsUngrouped: number }>(
      `${this.api}/properties/${id}${query}`,
    );
  }

  assignRooms(id: string, roomIds: string[]) {
    return this.http.post<{ assigned: number }>(`${this.api}/properties/${id}/rooms`, { roomIds });
  }

  unassignRoom(roomId: string) {
    return this.http.delete(`${this.api}/properties/rooms/${roomId}`);
  }

  // ── Expenses ──

  listExpenses(propertyId: string) {
    return this.http.get<Expense[]>(`${this.api}/properties/${propertyId}/expenses`);
  }

  createExpense(body: {
    propertyId: string; roomId?: string; category: ExpenseCategory;
    amountCents: number; incurredOn: string; receiptPath?: string; note?: string;
  }) {
    return this.http.post<Expense>(`${this.api}/properties/expenses`, body);
  }

  /** Partial. `roomId: null` detaches a room; omitting it leaves it alone. */
  updateExpense(id: string, body: Record<string, unknown>) {
    return this.http.patch<Expense>(`${this.api}/properties/expenses/${id}`, body);
  }

  deleteExpense(id: string) {
    return this.http.delete<{ deleted: true }>(`${this.api}/properties/expenses/${id}`);
  }

  /** `month` is YYYY-MM; omitted means the current one. */
  expenseSummary(month?: string) {
    const q = month ? `?month=${month}` : '';
    return this.http.get<ExpenseSummary>(`${this.api}/properties/expenses/summary${q}`);
  }

  expenseCsv(propertyId: string, year: number) {
    return this.http.get<{ filename: string; csv: string; count: number }>(
      `${this.api}/properties/${propertyId}/expenses/csv?year=${year}`,
    );
  }

  // ── Leases, renewal and notice ──
  //
  // On this service rather than a new one: a landlord thinks of "who is in, who
  // is out, who has not paid, whose lease is ending" as one screen, and the
  // yard dashboard is where all of it already lives.

  /** Fixed terms inside the lead window, and tenancies under notice. */
  upcomingLeases() {
    return this.http.get<UpcomingLease[]>(`${this.api}/tenancies/upcoming`);
  }

  /** `leaseEndDate: null` means month-to-month — a real value, not "unset". */
  updateLeaseTerms(
    tenancyId: string,
    body: { leaseEndDate?: string | null; noticePeriodDays?: number; startDate?: string },
  ) {
    return this.http.patch(`${this.api}/tenancies/${tenancyId}/lease`, body);
  }

  giveNotice(tenancyId: string, body: { givenBy: 'tenant' | 'landlord'; givenOn?: string }) {
    return this.http.post(`${this.api}/tenancies/${tenancyId}/notice`, body);
  }

  withdrawNotice(tenancyId: string) {
    return this.http.post(`${this.api}/tenancies/${tenancyId}/notice/withdraw`, {});
  }

  // ── Rent ──

  rentHistory(tenancyId: string) {
    return this.http.get<RentPeriod[]>(`${this.api}/properties/rent/${tenancyId}`);
  }

  markRent(tenancyId: string, periodStart: string, status: RentStatus) {
    return this.http.patch<RentPeriod>(`${this.api}/properties/rent/${tenancyId}/mark`, {
      periodStart, status,
    });
  }

  /** The tenant's answer to a month marked unpaid. Never overwrites the landlord's record. */
  disputeRent(periodId: string, note?: string) {
    return this.http.patch<RentPeriod>(`${this.api}/properties/rent/period/${periodId}/dispute`, { note });
  }

  setGraceDays(rentGraceDays: number) {
    return this.http.patch<{ rentGraceDays: number }>(`${this.api}/properties/rent/settings`, { rentGraceDays });
  }
}
