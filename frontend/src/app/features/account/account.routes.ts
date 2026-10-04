import { Routes } from '@angular/router';

/** Account settings — same page for both roles, guarded by authGuard only. */
export const ACCOUNT_ROUTES: Routes = [
  {
    path: 'settings',
    loadComponent: () => import('./settings/account-settings').then((m) => m.AccountSettings),
    title: 'Account settings — Mastande',
  },
  {
    // Phase 7g. In /account rather than under a role, because both roles get
    // notices and the page is identical — the sidebar follows the account's
    // own area, as on settings.
    path: 'notices',
    loadComponent: () => import('./notices/notices').then((m) => m.Notices),
    title: 'Your notices — Mastande',
  },
  {
    /**
     * Phase 7c. In /account rather than under a role for the same reason as
     * notices — the page and the endpoint are identical for both — and for one
     * stronger reason: a sub-lessor is a TENANT account that also lets a room,
     * so they hold conversations on both sides at once. Two role-scoped
     * inboxes would split one person's messages by a distinction they do not
     * have.
     */
    path: 'messages',
    loadComponent: () => import('./messages/messages').then((m) => m.MessagesInbox),
    title: 'Your messages — Mastande',
  },
  { path: '', redirectTo: 'settings', pathMatch: 'full' },
];
