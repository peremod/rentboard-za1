import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { CookieConsentBanner } from './shared/components/cookie-consent/cookie-consent';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CookieConsentBanner],
  template: `
    <router-outlet/>
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
