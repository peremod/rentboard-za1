import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { ArchiveListRow, ArchiveRecord } from '../models/tenancy-archive.model';

/**
 * Finished lettings — Phase F.
 *
 * Nothing here writes. The record is a record; the one write that belongs on a
 * finished letting is the tenant's answer to a rent month, and that stays on
 * `RentService.dispute` where its reasoning lives.
 */
@Injectable({ providedIn: 'root' })
export class TenancyArchiveService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Both sides in one list: a sub-lessor lets one room and rents another. */
  list() {
    return this.http.get<ArchiveListRow[]>(`${this.api}/tenancies/archive`);
  }

  record(tenancyId: string) {
    return this.http.get<ArchiveRecord>(`${this.api}/tenancies/archive/${tenancyId}`);
  }
}
