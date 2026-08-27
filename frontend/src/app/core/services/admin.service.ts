import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env/environment';
import { VerificationRequest, VerificationStatus } from '../models/verification.model';

export interface AdminStats {
  users: { total: number; landlords: number; tenants: number; suspended: number };
  rooms: { active: number; let: number; draft: number };
  applications: { total: number };
  moderation: { pendingVerifications: number };
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: 'TENANT' | 'LANDLORD' | 'ADMIN';
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  landlordProfile?: { idVerified: boolean; rating?: number | null } | null;
  _count?: { rooms: number };
}

/** A pending request, as the admin queue sees it — includes the document. */
export interface PendingVerification extends VerificationRequest {
  documentPath?: string | null;
  user: { id: string; fullName: string; email: string; createdAt: string };
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  getStats() {
    return this.http.get<AdminStats>(`${this.api}/admin/stats`);
  }

  findUsers(q?: string, role?: string) {
    let params = new HttpParams();
    if (q) params = params.set('q', q);
    if (role) params = params.set('role', role);
    return this.http.get<AdminUser[]>(`${this.api}/admin/users`, { params });
  }

  /** A reason is required when suspending; the API rejects the call without one. */
  setUserActive(id: string, isActive: boolean, reason?: string) {
    return this.http.patch<{ id: string; isActive: boolean }>(
      `${this.api}/admin/users/${id}/active`,
      { isActive, reason },
    );
  }

  recentRooms() {
    return this.http.get<any[]>(`${this.api}/admin/rooms`);
  }

  pendingVerifications() {
    return this.http.get<PendingVerification[]>(`${this.api}/verification/pending`);
  }

  reviewVerification(id: string, status: Extract<VerificationStatus, 'approved' | 'rejected'>, reviewNote?: string) {
    return this.http.patch<VerificationRequest>(
      `${this.api}/verification/${id}/review`,
      { status, reviewNote },
    );
  }
}
