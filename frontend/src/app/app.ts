import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet/>`,
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
