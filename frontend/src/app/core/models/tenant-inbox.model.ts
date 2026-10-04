/** Why something needs the tenant. The API decides; the screen never re-derives it. */
export type TenantInboxKind =
  | 'message_unread'
  | 'application_accepted'
  | 'application_shortlisted'
  | 'rent_unrecorded'
  | 'lease_ending'
  | 'notice_given'
  | 'passport_expired'
  | 'passport_expiring';

/**
 * One thing waiting on the tenant — Phase 7d.
 *
 * Deliberately the same shape as the landlord's `InboxItem`, so both lists can
 * be drawn by one `app-task-rows`. `actionPath` comes from the API rather than
 * being assembled in a template: Phase 7d had to go and fix two landlord-side
 * action paths that a route change had silently broken, and a path built in a
 * template is a path no check can resolve.
 */
export interface TenantInboxItem {
  kind: TenantInboxKind;
  urgency: number;
  title: string;
  detail: string | null;
  entityId: string;
  roomTitle: string | null;
  daysUntil: number | null;
  actionLabel: string;
  actionPath: string;
}

export interface TenantInbox {
  items: TenantInboxItem[];
  counts: Record<TenantInboxKind, number>;
}
