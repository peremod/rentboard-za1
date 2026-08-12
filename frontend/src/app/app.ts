import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { CookieConsentBanner } from './shared/components/cookie-consent/cookie-consent';
import { Navbar } from './shared/components/navbar/navbar';
import { Footer } from './shared/components/footer/footer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CookieConsentBanner, Navbar, Footer],
  template: `
    <app-navbar/>
    <main id="main-content"><router-outlet/></main>
    <app-footer/>
    <app-cookie-consent/>
  `,
})
export class App implements OnInit {
  private auth = inject(AuthService);

  ngOnInit() {
    // Sync user from server on startup; refreshUser() logs out silently if the token is stale.
    if (this.auth.token()) {
      this.auth.refreshUser()?.subscribe();
    }
  }
}
