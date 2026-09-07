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
    <app-navbar/>
    <main id="main-content"><router-outlet/></main>
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

      const returnUrl = new URLSearchParams(url.split('?')[1] ?? '').get('returnUrl');
      this.router.navigateByUrl(
        returnUrl ?? (this.auth.isLandlord() ? '/landlord/dashboard' : '/tenant/dashboard'),
      );
    });
  }
}
