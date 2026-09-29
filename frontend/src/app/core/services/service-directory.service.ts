import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env/environment';
import { ServiceCategory, ServiceProvider } from '../models/service-provider.model';

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
}
