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
  /** Search returns a narrow profile; the detail endpoint returns more. */
  landlordProfile?: { idVerified: boolean; rating?: number | null } | null;
  _count?: { rooms: number };
}

/** A pending request, as the admin queue sees it — includes the document. */
export interface PendingVerification extends VerificationRequest {
  documentPath?: string | null;
  user: { id: string; fullName: string; email: string; createdAt: string };
}

/**
 * Everything about one account. Note the absence of message content — counts
 * and counterparties are enough to resolve a dispute, and reading private
 * conversations is a power the platform deliberately does not take.
 */
export interface AdminUserDetail {
  user: Omit<AdminUser, 'landlordProfile'> & {
    phone?: string | null;
    marketingEmails?: boolean;
    authProvider?: string;
    /// Wider than the search payload: the detail endpoint also selects
    /// ratingCount and planTier.
    landlordProfile?: {
      idVerified: boolean;
      rating?: number | null;
      ratingCount: number;
      planTier?: string;
    } | null;
    tenantProfile?: { employmentStatus?: string | null; incomeVerified: boolean; idVerified: boolean } | null;
  };
  activity: { messagesSent: number; savedSearches: number; reportsFiled: number; reportsAgainst: number };
  rooms: { id: string; title: string; status: string; rentCents: number; locationDisplay: string;
           publishedAt?: string | null; viewCount: number; applicationCount: number; relistCount: number }[];
  applications: { id: string; status: string; createdAt: string; archivedAt?: string | null;
                  room?: { id: string; title: string; locationDisplay: string } | null }[];
  tenancies: { id: string; status: string; startDate?: string | null; endDate?: string | null;
               rentCents: number; room?: { title: string } | null }[];
  reviewsReceived: { id: string; type: string; rating: number; comment: string;
                     isHidden: boolean; publishedAt?: string | null }[];
  payments: { id: string; purpose: string; amountCents: number; status: string;
              paidAt?: string | null; createdAt: string }[];
  verifications: { id: string; type: string; status: string; reviewNote?: string | null;
                   createdAt: string; reviewedAt?: string | null }[];
}

export interface FunnelStep {
  step: string;
  count: number;
  /** Percentage of everyone who started. */
  ofStart: number;
  /** Percentage lost since the previous step — where to look first. */
  dropFromPrevious: number;
}

export interface Funnels {
  periodDays: number;
  listingFunnel: FunnelStep[];
  applyFunnel: FunnelStep[];
  featureUse: {
    alertsSaved: number; roomsSaved: number; suggestionsUsed: number;
    referralsShared: number; filtersUsed: number; adClicks: number;
  };
}

/** Derived from business data the platform already had — no tracking. */
export interface ContentSignals {
  activeRoomsWithoutPhoto: number;
  viewedButNeverApplied: number;
  draftsAbandonedOverAWeek: number;
  averageViewsPerActiveRoom: number;
}

export interface ReferralStats {
  total: number;
  pending: number;
  qualified: number;
  /** Signups that went on to do something. The number worth watching. */
  conversionPct: number;
  launchCodes: number;
  byCity: { city: string; codes: number; redemptions: number }[];
  topReferrers: { referrerId: string | null; _count: { id: number } }[];
}

export interface LaunchCode {
  id: string;
  code: string;
  city?: string | null;
  province?: string | null;
  maxUses?: number | null;
  useCount: number;
  isActive: boolean;
  expiresAt?: string | null;
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

  getFunnels(days = 30) {
    return this.http.get<Funnels>(`${this.api}/analytics/funnels?days=${days}`);
  }

  getContentSignals() {
    return this.http.get<ContentSignals>(`${this.api}/analytics/content-signals`);
  }

  getReferralStats() {
    return this.http.get<ReferralStats>(`${this.api}/referrals/admin/stats`);
  }

  getLaunchCodes(city?: string) {
    const q = city ? `?city=${encodeURIComponent(city)}` : '';
    return this.http.get<LaunchCode[]>(`${this.api}/referrals/admin/launch-codes${q}`);
  }

  getUserDetail(id: string) {
    return this.http.get<AdminUserDetail>(`${this.api}/admin/users/${id}`);
  }

  getKpis(days = 30) {
    return this.http.get<AdminKpis>(`${this.api}/admin/kpis?days=${days}`);
  }

  // ── Advertising ──────────────────────────────────────────────────────────

  listCampaigns(status?: string) {
    const q = status ? `?status=${status}` : '';
    return this.http.get<AdCampaign[]>(`${this.api}/ads/campaigns${q}`);
  }

  listAdvertisers() {
    return this.http.get<{ id: string; companyName: string; _count?: { campaigns: number } }[]>(
      `${this.api}/ads/advertisers`,
    );
  }

  /** Created from a won enquiry, so the contact details are already known. */
  createAdvertiser(payload: { companyName: string; contactName: string; contactEmail: string; contactPhone?: string; notes?: string }) {
    return this.http.post<{ id: string; companyName: string }>(`${this.api}/ads/advertisers`, payload);
  }

  createCampaign(payload: {
    advertiserId: string; name: string; placement: string; headline: string;
    body?: string; imagePath?: string; targetUrl: string; province?: string; city?: string;
    suburbSlug?: string; monthlyRateCents: number; startsAt: string; endsAt: string;
  }) {
    return this.http.post<AdCampaign>(`${this.api}/ads/campaigns`, payload);
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
