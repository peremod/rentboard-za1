import { RoomType } from './room.model';

export type AlertFrequency = 'instant' | 'daily' | 'off';

/**
 * A tenant's standing search. Criteria mirror the board filters; a null or
 * undefined field means "no constraint on this".
 */
export interface SavedSearch {
  id: string;
  tenantId: string;
  name: string;

  province?: string | null;
  city?: string | null;
  roomType?: RoomType | null;
  maxRentCents?: number | null;
  minRentCents?: number | null;
  billsIncluded?: boolean | null;
  couplesAllowed?: boolean | null;
  dssAccepted?: boolean | null;
  guarantorAccepted?: boolean | null;
  petsAllowed?: boolean | null;

  frequency: AlertFrequency;
  isActive: boolean;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;

  lastNotifiedAt?: string | null;
  matchCount: number;
  createdAt: string;
}

export type SaveSearchPayload = Omit<
  SavedSearch,
  'id' | 'tenantId' | 'matchCount' | 'lastNotifiedAt' | 'createdAt'
> & Partial<Pick<SavedSearch, 'frequency' | 'isActive' | 'notifyEmail' | 'notifyWhatsapp'>>;
