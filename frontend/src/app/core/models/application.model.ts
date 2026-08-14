import { Room } from './room.model';

export type ApplicationStatus = 'pending' | 'viewed' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn';

export interface Application {
  id: string;
  roomId: string;
  tenantId: string;
  status: ApplicationStatus;
  coverNote?: string | null;
  room?: Room;
  createdAt: string;
  updatedAt: string;
}
