export type ReferralStatus = 'pending' | 'qualified' | 'rewarded' | 'void';
export type ReferralReward = 'none' | 'free_verification';

export interface Referral {
  id: string;
  status: ReferralStatus;
  reward: ReferralReward;
  /** What the referee did to qualify — 'published_room' or 'applied'. */
  qualifyingAction?: string | null;
  qualifiedAt?: string | null;
  rewardUsedAt?: string | null;
  createdAt: string;
  referee: { fullName: string; role: 'TENANT' | 'LANDLORD' };
}

export interface MyReferrals {
  code: string;
  referrals: Referral[];
  summary: {
    total: number;
    pending: number;
    qualified: number;
    freeVerificationsAvailable: number;
  };
}

export interface CodeCheck {
  valid: boolean;
  /** Display name only — the API never returns the referrer's identity. */
  invitedBy?: string;
}
