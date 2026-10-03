import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';

export interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  whatsappSentAt: string | null;
  whatsappError: string | null;
  createdAt: string;
}

/**
 * In-app notices — the channel that works when there is no email address.
 *
 * ⚠️ Worth knowing what these are before changing anything here. A notice is
 * not a nicety layered on top of email: for an account with no email address it
 * is the ONLY channel that cannot fail for reasons outside our control.
 * WhatsApp is attempted on top, but Meta permits free-form text only inside a
 * 24-hour window, so for anyone who has not messaged recently the notice is the
 * whole notification.
 *
 * The unread count is kept in a signal so the nav badge and the page read the
 * same number from one call rather than polling separately.
 */
@Injectable({ providedIn: 'root' })
export class NoticesService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly unreadCount = signal(0);
  readonly notices = signal<Notice[]>([]);

  /** Everything, read or not — for the notices screen. */
  load() {
    return this.http.get<Notice[]>(`${this.api}/notices`).pipe(
      tap((list) => {
        this.notices.set(list);
        this.unreadCount.set(list.filter((n) => !n.readAt).length);
      }),
    );
  }

  /** Just the count, for a screen that only draws the badge. */
  refreshUnread() {
    return this.http
      .get<{ count: number; items: Notice[] }>(`${this.api}/notices/unread`)
      .pipe(tap((res) => this.unreadCount.set(res.count)));
  }

  markRead(id: string) {
    return this.http.patch<{ updated: number }>(`${this.api}/notices/${id}/read`, {}).pipe(
      tap(() => {
        this.notices.update((list) =>
          list.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
        );
        this.unreadCount.update((c) => Math.max(0, c - 1));
      }),
    );
  }

  markAllRead() {
    return this.http.post<{ updated: number }>(`${this.api}/notices/read-all`, {}).pipe(
      tap(() => {
        const now = new Date().toISOString();
        this.notices.update((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: now })));
        this.unreadCount.set(0);
      }),
    );
  }
}
