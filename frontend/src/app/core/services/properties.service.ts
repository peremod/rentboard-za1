import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import {
  HousemateProfile, Property, RelistAllResult, RentPeriod, RentStatus, YardDashboard,
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

  remove(id: string) {
    return this.http.delete<{ deleted: true; roomsUngrouped: number }>(`${this.api}/properties/${id}`);
  }

  assignRooms(id: string, roomIds: string[]) {
    return this.http.post<{ assigned: number }>(`${this.api}/properties/${id}/rooms`, { roomIds });
  }

  unassignRoom(roomId: string) {
    return this.http.delete(`${this.api}/properties/rooms/${roomId}`);
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
