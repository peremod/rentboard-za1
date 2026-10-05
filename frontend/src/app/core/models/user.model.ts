export type UserRole = 'TENANT' | 'LANDLORD' | 'ADMIN';

export interface User {
  id: string;
  /**
   * ⚠️ Optional since Phase 7g: an account created from a mobile number has
   * none. Code that renders this must handle its absence — the settings screen
   * read "Currently <strong>{{ email }}</strong>" and rendered an empty bold.
   */
  email?: string | null;
  role: UserRole;
  fullName: string;
  phone?: string | null;
  /** True once a code sent to that number has been confirmed. */
  phoneVerified?: boolean;
  /** Marketing consent. Transactional mail is unaffected by this. */
  marketingEmails?: boolean;
  avatarPath?: string | null;
  isVerified: boolean;
  /**
   * Whether this account has a password at all — Phase 7o.
   *
   * Derived on the server from `passwordHash`; the hash itself never leaves it.
   * False for an account created from a mobile number, which is why the
   * settings screen offered it a "Change password" form that could only ever
   * answer with a message about Google.
   */
  hasPassword?: boolean;
  /** 'email', 'google', 'phone', 'magic_link'. Decides which forms make sense. */
  authProvider?: string;
  createdAt?: string;
  /**
   * When this account was last shown round the product — Phase 7f.
   *
   * Null or absent means never, which is what the portal checks. Server-side
   * rather than in the browser: a phone here is shared and replaced, so a
   * per-browser flag shows the walkthrough to people who have seen it and
   * hides it from people who have not.
   */
  walkthroughSeenAt?: string | null;

  /**
   * Screen keys whose first-use hint this account has put away — Phase 8b.
   *
   * Optional, and `?? []` wherever it is read: an older cached session, or the
   * refresh-reuse path before it carried the field, answers `undefined`, and
   * treating that as "has seen everything" would hide every hint from the
   * person who has seen none of them.
   */
  hintsSeen?: string[];
  /**
   * Non-null means the owner paused their own account — Phase 7g.
   *
   * ⚠️ Not the same as `isActive`, which is an admin suspension and blocks
   * sign-in. This one deliberately does not: signing in is how somebody comes
   * back, so the portal reads this and offers to wake the account up.
   */
  deactivatedAt?: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  /** True once a code sent to that number has been confirmed. */
  phoneVerified?: boolean;
  /** Marketing consent. Transactional mail is unaffected by this. */
  marketingEmails?: boolean;
  role: 'TENANT' | 'LANDLORD';
}
