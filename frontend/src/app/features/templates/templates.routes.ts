import { Routes } from '@angular/router';

/** Public — see the component note on why these are not behind the portal. */
export const TEMPLATES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./templates-list').then((m) => m.TemplatesList),
    title: 'Forms and templates — Mastande',
  },
  {
    path: ':slug',
    loadComponent: () => import('./template-document').then((m) => m.TemplateDocument),
    title: 'Template — Mastande',
  },
];
