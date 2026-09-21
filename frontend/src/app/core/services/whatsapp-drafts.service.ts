import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { RoomType } from '../models/room.model';

/**
 * A listing a landlord started over WhatsApp.
 *
 * Nothing here is on the board. Every parsed field is nullable because the
 * parser is deliberately simple — a blank is an honest "we could not tell",
 * and the landlord fills it in when they claim the draft.
 */
export interface WhatsappDraft {
  id: string;
  status: 'collecting' | 'ready' | 'claimed' | 'abandoned';
  rawText?: string | null;
  imagePaths: string[];
  parsedTitle?: string | null;
  parsedRentCents?: number | null;
  parsedRoomType?: RoomType | null;
  parsedProvince?: string | null;
  parsedCity?: string | null;
  parsedSuburb?: string | null;
  lastMessageAt: string;
}

@Injectable({ providedIn: 'root' })
export class WhatsappDraftsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  readonly drafts = signal<WhatsappDraft[]>([]);

  load() {
    return this.http
      .get<WhatsappDraft[]>(`${this.api}/whatsapp/drafts`)
      .pipe(tap((list) => this.drafts.set(list)));
  }

  /** Turns a draft into a room draft. Idempotent on the API side. */
  claim(id: string) {
    return this.http.post<{ roomId: string; alreadyClaimed: boolean }>(
      `${this.api}/whatsapp/drafts/${id}/claim`, {},
    );
  }
}
