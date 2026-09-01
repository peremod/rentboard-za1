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

export interface AdminKpis {
  periodDays: number;
  growth: {
    newUsers: number; newUsersChange: number;
    newRooms: number; newRoomsChange: number;
    newApplications: number; newApplicationsChange: number;
  };
  health: {
    listingsWithApplicationsPct: number;
    landlordResponsePct: number;
    roomsLet: number;
    applicationsPerActiveRoom: number;
  };
  trust: { verifiedLandlords: number; unverifiedLandlords: number; verifiedPct: number };
  queues: { openReports: number; pendingVerifications: number; newEnquiries: number };
}

export interface AdCampaign {
  id: string;
  name: string;
  placement: string;
  headline: string;
  status: string;
  province?: string | null;
  city?: string | null;
  impressions: number;
  clicks: number;
  monthlyRateCents: number;
  startsAt: string;
  endsAt: string;
  advertiser?: { companyName: string };
}

export interface AdEnquiry {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  industry?: string | null;
  province?: string | null;
  message: string;
  status: 'new' | 'contacted' | 'won' | 'lost';
  adminNotes?: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  getKpis(days = 30) {
    return this.http.get<AdminKpis>(`${this.api}/admin/kpis?days=${days}`);
  }

  // ── Advertising ──────────────────────────────────────────────────────────

  listCampaigns(status?: string) {
    const q = status ? `?status=${status}` : '';
    return this.http.get<AdCampaign[]>(`${this.api}/ads/campaigns${q}`);
  }

  reviewCampaign(id: string, status: 'approved' | 'rejected', rejectionReason?: string) {
    return this.http.patch<AdCampaign>(`${this.api}/ads/campaigns/${id}/review`, { status, rejectionReason });
  }

  setCampaignStatus(id: string, status: 'active' | 'paused' | 'ended') {
    return this.http.patch<AdCampaign>(`${this.api}/ads/campaigns/${id}/status`, { status });
  }

  listEnquiries(status?: string) {
    const q = status ? `?status=${status}` : '';
    return this.http.get<AdEnquiry[]>(`${this.api}/ads/enquiries${q}`);
  }

  updateEnquiry(id: string, status: string, adminNotes?: string) {
    return this.http.patch<AdEnquiry>(`${this.api}/ads/enquiries/${id}`, { status, adminNotes });
  }

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
