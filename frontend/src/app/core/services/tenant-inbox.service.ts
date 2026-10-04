import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { TenantInbox } from '../models/tenant-inbox.model';

@Injectable({ providedIn: 'root' })
export class TenantInboxService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Everything waiting on this person as a tenant, most pressing first. */
  inbox(): Observable<TenantInbox> {
    return this.http.get<TenantInbox>(`${this.api}/tenant-inbox`);
  }
}
