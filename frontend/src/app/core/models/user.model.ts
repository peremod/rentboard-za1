export type UserRole = 'TENANT' | 'LANDLORD' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone?: string | null;
  /** Marketing consent. Transactional mail is unaffected by this. */
  marketingEmails?: boolean;
  avatarPath?: string | null;
  isVerified: boolean;
  createdAt?: string;
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
  /** Marketing consent. Transactional mail is unaffected by this. */
  marketingEmails?: boolean;
  role: 'TENANT' | 'LANDLORD';
}
