import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env/environment';
import { ServiceCategory, ServiceProvider } from '../models/service-provider.model';

/**
 * What each contractor was sent, and what it comes to — Phase 7k.
 *
 * ⚠️ `disclaimer` is part of the payload, not decoration. Nothing here has
 * been invoiced or paid, and the product cannot do either: contractors have no
 * account. Anything built on these figures reads that field first.
 */
export interface ContractorLeadSummary {
  disclaimer: string;
  noRatesConfigured: boolean;
  rates: { category: ServiceCategory; amountCents: number; effectiveFrom: string; note?: string | null }[];
  rows: {
    provider: { id: string; name: string; category: ServiceCategory; active: boolean };
    agreedToLeadFees: boolean;
    agreementNote?: string | null;
    leads: { billable: number; notBillable: number };
    wouldOweCents: number;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ServiceDirectoryService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Active providers only — what a landlord sees. */
  list(filters: { category?: ServiceCategory; area?: string } = {}) {
    let params = new HttpParams();
    if (filters.category) params = params.set('category', filters.category);
    if (filters.area?.trim()) params = params.set('area', filters.area.trim());
    return this.http.get<ServiceProvider[]>(`${this.api}/services`, { params });
  }

  // ── Admin ──

  /** Everything, including the ones not yet live. */
  listAll() {
    return this.http.get<ServiceProvider[]>(`${this.api}/services/admin/all`);
  }

  create(body: {
    category: ServiceCategory;
    name: string;
    phone: string;
    areas: string[];
    whatsapp?: boolean;
    note?: string;
    active?: boolean;
  }) {
    return this.http.post<ServiceProvider>(`${this.api}/services/admin`, body);
  }

  update(id: string, body: Record<string, unknown>) {
    return this.http.patch<ServiceProvider>(`${this.api}/services/admin/${id}`, body);
  }

  remove(id: string) {
    return this.http.delete<{ deleted: true }>(`${this.api}/services/admin/${id}`);
  }

  /**
   * Record that this landlord was handed a contractor's number — Phase 7k.
   *
   * ⚠️ Fire and forget, and that is deliberate. The landlord pressed Call: the
   * phone dialler must open whether or not this request succeeds, so the
   * subscribe swallows errors and nothing waits on it. A failed bookkeeping
   * write must never stand between somebody with a burst pipe and a plumber.
   *
   * Deduplicated server-side to one per landlord per day, so a landlord tapping
   * while the phone rings does not create five.
   */
  recordLead(id: string, channel: 'call' | 'whatsapp') {
    return this.http.post<{ recorded: boolean }>(
      `${this.api}/services/${id}/lead`, { channel },
    );
  }

  /** Leads per contractor and what they come to — a record, never an invoice. */
  leadSummary(params?: { from?: string; to?: string }) {
    let p = new HttpParams();
    if (params?.from) p = p.set('from', params.from);
    if (params?.to) p = p.set('to', params.to);
    return this.http.get<ContractorLeadSummary>(`${this.api}/services/admin/leads`, { params: p });
  }

  setLeadRate(body: { category: string; amountCents: number; effectiveFrom: string; note?: string }) {
    return this.http.post(`${this.api}/services/admin/lead-rates`, body);
  }

  recordLeadFeesAgreed(id: string, note: string) {
    return this.http.post<{ agreedAt: string; note: string }>(
      `${this.api}/services/admin/${id}/lead-fees-agreed`, { note },
    );
  }
}
