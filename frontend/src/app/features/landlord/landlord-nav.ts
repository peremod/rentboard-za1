import { PortalNavItem } from '../../shared/components/portal-shell/portal-shell';

/** Counts shown as badges. A screen that does not know one leaves it out. */
export interface LandlordNavBadges {
  /**
   * Applicants WAITING ON THE LANDLORD — never opened, or they have said
   * something since you last looked. Phase 7c narrowed it from "every
   * application ever received", which never went down and so was never read.
   * The definition is the server's, in `ApplicationsService.inbox`, so the two
   * screens that draw this badge cannot disagree about it.
   */
  applicants?: number;
  /** Rooms started and never published — Phase 7a. */
  drafts?: number;
  /** Unread in-app notices — Phase 7g. */
  notices?: number;
}

/**
 * One definition of the landlord's navigation, for the same reason
 * `ADMIN_NAV` exists — except this side had three copies and they disagreed.
 *
 * The dashboard listed eight items, the yard four, and the verification page
 * two. So the nav SHRANK as a landlord moved through their own portal: from
 * /landlord/verification there was no way to reach their property or their
 * settings at all, and "My property" was called "Property" on one screen and
 * "My property" on another. Every one of those screens compiled, rendered and
 * navigated correctly — the defect was only visible by signing in and walking
 * from page to page, which is how it was found.
 *
 * Badges are passed in rather than read here: the counts come from services
 * the dashboard already injects, and a nav definition that injected them would
 * make every screen fetch the dashboard's data to draw a sidebar.
 */
export function landlordNav(badges: LandlordNavBadges = {}): PortalNavItem[] {
  return [
    { label: 'Dashboard', icon: '📊', route: '/landlord/dashboard', exact: true },
    // These two name sections of the dashboard, not pages of their own.
    // Without the fragment they navigate to the dashboard root, which from the
    // dashboard is indistinguishable from a click that did nothing.
    // Named after the section it jumps to, exactly — Phase 7a.
    //
    // It said "My Rooms" and landed on a section headed "Active listings",
    // which is two names for one place; worse, a landlord whose rooms are all
    // drafts clicked "My Rooms" and read "No rooms listed yet" while holding
    // three of them. The two names are now one, and Drafts has its own entry
    // below so the other case is reachable rather than inferred.
    { label: 'Active listings', icon: '🏠', route: '/landlord/dashboard', fragment: 'active-listings' },
    { label: 'Drafts', icon: '📝', route: '/landlord/dashboard', fragment: 'drafts', badge: badges.drafts },
    // ⚠️ History, because it explains the item below and the one after it.
    // There was an "Applicants" item here pointing at #active-listings, and it
    // was a promise the dashboard could not keep: there was no applicants
    // screen, and no section by that name. Phase 7a therefore deleted it and
    // moved the COUNT onto Active listings. Phase 7c built the screen, so the
    // entry is back as "All applicants" below, with the count on it where it
    // belongs; Active listings carries no badge any more, because two items
    // showing the same number is how a landlord learns to read neither.
    //
    // This slot keeps pointing at the section that exists for the things
    // waiting on a landlord — applications first among them.
    { label: 'Needs you', icon: '👀', route: '/landlord/dashboard', fragment: 'needs-attention' },
    // Phase 7c. Phase 7a DELETED an "Applicants" item from this nav because it
    // pointed at a dashboard section of another name — a destination that did
    // not exist. The entry is back because the destination is: one list across
    // every room, which is the question a landlord with six of them actually
    // has. The badge counts what is waiting on them, not everything ever sent.
    { label: 'All applicants', icon: '📥', route: '/landlord/applicants', badge: badges.applicants },
    // Phase 7c. Was `disabled` with a "Soon" chip, because until now threads
    // lived only inside an application and there was no inbox to point at.
    // There is now: /account/messages, one screen for both roles — see the
    // route for why it is in /account rather than here.
    { label: 'Messages', icon: '💬', route: '/account/messages' },
    // Phase 7b. Was "My property" → /landlord/yard, which was both singular for
    // a thing a landlord can have several of and a word ("yard") that appeared
    // nowhere else in the nav. The screen behind it is now a list of properties
    // with a detail view, and the label says so.
    { label: 'My properties', icon: '🏘️', route: '/landlord/properties' },
    { label: 'Verification', icon: '🪪', route: '/landlord/verification' },
    // A reason to open the app with no vacancy and no rent due: something is
    // broken and you need a number.
    { label: 'Your public page', icon: '🪧', route: '/landlord/public-page' },
    { label: 'Who to call', icon: '🔧', route: '/landlord/services' },
    // Phase 7g. Not optional furniture: for a landlord with no email address
    // this screen is the only place a notification can be read at all.
    { label: 'Notices', icon: '🔔', route: '/account/notices', badge: badges.notices },
    { label: 'Settings', icon: '⚙️', route: '/account/settings' },
    // No Billing entry. It pointed at /landlord/upgrade, which has been
    // deleted — there are no paid plans to bill for, so a landlord has no
    // billing to look at. Restoring this means restoring a real page first.
  ];
}
