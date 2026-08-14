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
  coverNote?: string | null;
  room?: Room;
  tenant?: ApplicationTenant;
  createdAt: string;
  updatedAt: string;
}
