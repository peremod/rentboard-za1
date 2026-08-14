import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { Message } from '../models/message.model';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  getThread(applicationId: string): Observable<Message[]> {
    return this.http.get<Message[]>(`${this.api}/applications/${applicationId}/messages`);
  }

  send(applicationId: string, body: string): Observable<Message> {
    return this.http.post<Message>(`${this.api}/applications/${applicationId}/messages`, { body });
  }
}
