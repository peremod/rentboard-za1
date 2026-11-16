import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { CookieConsentBanner } from './shared/components/cookie-consent/cookie-consent';
import { AppDialog } from './shared/components/app-dialog/app-dialog';
import { Navbar } from './shared/components/navbar/navbar';
import { Footer } from './shared/components/footer/footer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CookieConsentBanner, Navbar, Footer, AppDialog],
  template: `
    <!-- 2.4.1 Bypass Blocks, Level A. Driven by
         scripts/a11y-keyboard-drive.mjs: there was no skip link on any page,
         so a keyboard user tabbed the whole navigation before reaching
         content, every time.
         What made it worth a comment: the TARGET below already existed, and
         styles.scss already carried a rule for it commented "Skip link target
         used by the app shell". The id and the CSS were built; the link never
         was. Another control that only looked like one.
         First in the DOM so it is the first tab stop, which is the half of
         2.4.1 that a link alone does not satisfy. -->
    <a class="skip-link" href="#main-content">Skip to the main content</a>
    <app-navbar/>
    <main id="main-content" tabindex="-1"><router-outlet/></main>
    <app-footer/>
    <app-cookie-consent/>
    <app-dialog/>
  `,
})
export class App implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  ngOnInit() {
    // No token is ever persisted client-side (auth hardening, v0.9.2) — the
    // only way to know if there's a session is to ask the server, via the
    // httpOnly refresh cookie. Silently does nothing if there isn't one.
    // If a guard redirected to login before the refresh finished, send the
    // person where they were going once it succeeds. Belt and braces: the
    // guards now wait for sessionReady, but a restored session that leaves
    // someone staring at a login form is a bad enough outcome to defend twice.
    this.auth.restoreSession().subscribe((user) => {
      if (!user) return;

      const url = this.router.url;
      if (!url.startsWith('/auth/login')) return;

      // Unwrap any nested returnUrl and never navigate back to a login page,
      // which would leave the person exactly where they started.
      let target = new URLSearchParams(url.split('?')[1] ?? '').get('returnUrl') ?? '';
      let guard = 0;
      while (target.includes('returnUrl=') && guard++ < 5) {
        target = decodeURIComponent(target.split('returnUrl=')[1] ?? '');
      }

      if (!target || target.startsWith('/auth/login')) {
        target = this.auth.homeRoute();
      }
      this.router.navigateByUrl(target);
    });
  }
}
