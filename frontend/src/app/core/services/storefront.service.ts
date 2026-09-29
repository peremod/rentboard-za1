import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { MyStorefront, PublicStorefront } from '../models/storefront.model';

/**
 * The storefront, public read and owner edit.
 *
 * There is no `updateSlug`. The slug is in the sitemap and in whatever anyone
 * has shared, so changing it would 404 every link that pointed at the page —
 * a rename needs a redirect table, which is a bigger thing than this phase.
 */
@Injectable({ providedIn: 'root' })
export class StorefrontService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Public. No auth — this is the indexable surface. */
  bySlug(slug: string) {
    return this.http.get<PublicStorefront>(`${this.api}/storefronts/${slug}`);
  }

  mine() {
    return this.http.get<MyStorefront>(`${this.api}/landlord/storefront`);
  }

  updateMine(body: { bio?: string; logoPath?: string | null; storefrontLive?: boolean }) {
    return this.http.patch<MyStorefront>(`${this.api}/landlord/storefront`, body);
  }
}
