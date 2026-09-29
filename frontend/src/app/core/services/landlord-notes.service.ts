import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { CalendarEntry, LandlordNote, NotesForTenant } from '../models/landlord-note.model';

/**
 * Private notes, and the dated view over them.
 *
 * There is no "notes about me" call and there is not going to be one. A tenant's
 * POPIA s.23 right of access is against the landlord, and satisfying it through a
 * self-service endpoint would turn a private memory aid into a channel for
 * arguing with it — that path is admin-assisted and logged.
 */
@Injectable({ providedIn: 'root' })
export class LandlordNotesService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  forTenant(tenantId: string) {
    return this.http.get<LandlordNote[]>(`${this.api}/landlord/notes/tenant/${tenantId}`);
  }

  all() {
    return this.http.get<NotesForTenant[]>(`${this.api}/landlord/notes`);
  }

  /** Only about someone who has applied to your room or rented from you. */
  write(tenantId: string, body: string) {
    return this.http.post<LandlordNote>(`${this.api}/landlord/notes/tenant/${tenantId}`, { body });
  }

  update(id: string, body: string) {
    return this.http.patch<LandlordNote>(`${this.api}/landlord/notes/${id}`, { body });
  }

  remove(id: string) {
    return this.http.delete<{ deleted: true }>(`${this.api}/landlord/notes/${id}`);
  }

  calendar() {
    return this.http.get<CalendarEntry[]>(`${this.api}/landlord/calendar`);
  }
}
