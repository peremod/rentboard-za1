import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env/environment';

export type AdPlacement = 'board_sidebar' | 'board_inline' | 'room_detail';

/** What the API returns. Note there is no tracking id and no user reference. */
export interface Ad {
  id: string;
  headline: string;
  body?: string | null;
  imagePath?: string | null;
  ctaLabel: string;
  advertiser: string;
  clickUrl: string;
}

@Injectable({ providedIn: 'root' })
export class AdsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * Ads for the page context — never for the person. Province and room type
   * describe what is being looked at, not who is looking.
   */
  getAds(placement: AdPlacement, context: { province?: string; city?: string; roomType?: string } = {}) {
    let params = new HttpParams().set('placement', placement);
    if (context.province) params = params.set('province', context.province);
    if (context.city) params = params.set('city', context.city);
    if (context.roomType) params = params.set('roomType', context.roomType);
    return this.http.get<Ad[]>(`${this.api}/ads`, { params });
  }

  /**
   * Aggregate counter. Sent once per render, with no identifier attached —
   * the server increments a number and learns nothing about the visitor.
   */
  recordImpressions(campaignIds: string[]) {
    if (campaignIds.length === 0) return;
    this.http.post(`${this.api}/ads/impressions`, { campaignIds }).subscribe({ error: () => {} });
  }

  /** Public enquiry form. Rate limited server-side to 3 per hour. */
  submitEnquiry(enquiry: AdEnquiry) {
    return this.http.post<{ id: string; message: string }>(`${this.api}/ads/enquiries`, enquiry);
  }

  clickUrl(ad: Ad): string {
    return `${this.api}/ads/${ad.id}/click`;
  }
}

export interface AdEnquiry {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  industry?: string;
  message: string;
  province?: string;
}
