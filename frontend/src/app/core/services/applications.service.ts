import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { Application } from '../models/application.model';

@Injectable({ providedIn: 'root' })
export class ApplicationsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  apply(roomId: string, coverNote?: string): Observable<Application> {
    return this.http.post<Application>(`${this.api}/applications`, { roomId, coverNote });
  }

  getMyApplications(): Observable<Application[]> {
    return this.http.get<Application[]>(`${this.api}/applications/mine`);
  }
}
