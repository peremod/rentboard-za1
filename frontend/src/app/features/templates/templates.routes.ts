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
    /**
     * ⚠️ The slug, not a fixed word. TemplateDocument calls SeoService once
     * the document loads and the real title wins — but this is what a crawler
     * sees if that fetch is slow or fails, and 'Template — Mastande' is the
     * SAME string on every template in the set. Duplicate titles across
     * unrelated pages are the one metadata fault that is entirely self-
     * inflicted, so the fallback carries the only distinguishing thing the
     * router knows before any data arrives.
     */
    title: (route) => {
      const slug = route.paramMap.get('slug') ?? '';
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return name ? `${name} — free South African template | Mastande` : 'Forms and templates — Mastande';
    },
  },
];
