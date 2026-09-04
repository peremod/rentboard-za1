import { Room } from './room.model';

export type ApplicationStatus = 'pending' | 'viewed' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn';

export interface ApplicationTenant {
  id: string;
  fullName: string;
  email: string;
  avatarPath?: string | null;
  isVerified: boolean;
}

export interface Application {
  id: string;
  roomId: string;
  tenantId: string;
  status: ApplicationStatus;
  /** When the landlord accepted or rejected. Drives the 30-minute undo window. */
  decidedAt?: string | null;
  /** True once the room was relisted or let to someone else. */
  isArchived?: boolean;
  /** Human-readable reason, present only when isArchived. */
  archivedReason?: string | null;
  /** Letting cycle this application belongs to. */
  cycle?: number;
  coverNote?: string | null;
  room?: Room;
  tenant?: ApplicationTenant;
  createdAt: string;
  updatedAt: string;
}
