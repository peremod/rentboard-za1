import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '@env/environment';
import { Room, RoomFilters, PaginatedRooms, RelistPayload } from '../models/room.model';

/**
 * RoomsService — Angular data layer for the Rooms API added in this pass.
 * `filters` is a shared signal so the (future) search bar, sidebar filters,
 * and grid components all read/write the same state without prop-drilling.
 *
 * Response caching: identical queries within 60s reuse the same Observable
 * (shareReplay) instead of re-hitting the API — cache is busted on any write.
 */
@Injectable({ providedIn: 'root' })
export class RoomsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;
  private cache = new Map<string, Observable<PaginatedRooms>>();

  readonly filters = signal<RoomFilters>({ sortBy: 'newest', page: 1, limit: 12 });

  getRooms(filters: RoomFilters): Observable<PaginatedRooms> {
    const key = JSON.stringify(filters);
    if (this.cache.has(key)) return this.cache.get(key)!;

    let params = new HttpParams()
      .set('page', filters.page ?? 1)
      .set('limit', filters.limit ?? 12)
      .set('sortBy', filters.sortBy ?? 'newest');

    if (filters.search) params = params.set('search', filters.search);
    if (filters.roomType) params = params.set('roomType', filters.roomType);
    if (filters.province) params = params.set('province', filters.province);
    if (filters.city) params = params.set('city', filters.city);
    if (filters.maxRentCents) params = params.set('maxRentCents', filters.maxRentCents);
    if (filters.billsIncluded) params = params.set('billsIncluded', 'true');
    if (filters.couplesAllowed) params = params.set('couplesAllowed', 'true');
    if (filters.dssAccepted) params = params.set('dssAccepted', 'true');
    if (filters.guarantorAccepted) params = params.set('guarantorAccepted', 'true');
    if (filters.petsAllowed) params = params.set('petsAllowed', 'true');

    const req$ = this.http.get<PaginatedRooms>(`${this.api}/rooms`, { params }).pipe(shareReplay(1));
    this.cache.set(key, req$);
    setTimeout(() => this.cache.delete(key), 60_000);
    return req$;
  }

  getRoom(id: string): Observable<Room> {
    return this.http.get<Room>(`${this.api}/rooms/${id}`);
  }

  createRoom(data: Partial<Room>): Observable<Room> {
    this.bustCache();
    return this.http.post<Room>(`${this.api}/rooms`, data);
  }

  updateRoom(id: string, data: Partial<Room>): Observable<Room> {
    this.bustCache();
    return this.http.patch<Room>(`${this.api}/rooms/${id}`, data);
  }

  publishRoom(id: string): Observable<Room> {
    this.bustCache();
    return this.http.post<Room>(`${this.api}/rooms/${id}/publish`, {});
  }

  markReserved(id: string): Observable<Room> {
    this.bustCache();
    return this.http.post<Room>(`${this.api}/rooms/${id}/reserve`, {});
  }

  markLet(id: string): Observable<Room> {
    this.bustCache();
    return this.http.post<Room>(`${this.api}/rooms/${id}/let`, {});
  }

  undoLet(id: string): Observable<Room> {
    this.bustCache();
    return this.http.post<Room>(`${this.api}/rooms/${id}/undo-let`, {});
  }

  relistRoom(id: string, payload: RelistPayload = {}): Observable<Room> {
    this.bustCache();
    return this.http.post<Room>(`${this.api}/rooms/${id}/relist`, payload);
  }

  getLandlordRooms(): Observable<Room[]> {
    return this.http.get<Room[]>(`${this.api}/rooms/my-rooms`);
  }

  getArchivedRooms(): Observable<Room[]> {
    return this.http.get<Room[]>(`${this.api}/rooms/my-rooms/archived`);
  }

  updateFilters(partial: Partial<RoomFilters>) {
    this.filters.update((f) => ({ ...f, ...partial, page: 1 }));
  }

  resetFilters() {
    this.filters.set({ sortBy: 'newest', page: 1, limit: 12 });
  }

  private bustCache() {
    this.cache.clear();
  }
}
