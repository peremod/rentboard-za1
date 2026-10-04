import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';
import { Message, MessageInbox } from '../models/message.model';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  getThread(applicationId: string): Observable<Message[]> {
    return this.http.get<Message[]>(`${this.api}/applications/${applicationId}/messages`);
  }

  /**
   * Every conversation this account is in — Phase 7c.
   *
   * Not under `/applications/:id/messages`, which is the right path for one
   * thread and the wrong one for a list of them: there is no application id to
   * put in it. One endpoint serves both roles; the server scopes each row to
   * the caller as either the room's lister or the applicant.
   */
  inbox(): Observable<MessageInbox> {
    return this.http.get<MessageInbox>(`${this.api}/messages/inbox`);
  }

  send(applicationId: string, body: string): Observable<Message> {
    return this.http.post<Message>(`${this.api}/applications/${applicationId}/messages`, { body });
  }
}
