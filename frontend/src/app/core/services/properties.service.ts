import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { Property, RentPeriod, RentStatus, YardDashboard } from '../models/property.model';

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

  create(body: { name: string; suburb?: string; city: string; province: string }) {
    return this.http.post<Property>(`${this.api}/properties`, body);
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
