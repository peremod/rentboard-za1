import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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

  ngOnInit() {
    // No token is ever persisted client-side (auth hardening, v0.9.2) — the
    // only way to know if there's a session is to ask the server, via the
    // httpOnly refresh cookie. Silently does nothing if there isn't one.
    this.auth.restoreSession().subscribe();
  }
}
