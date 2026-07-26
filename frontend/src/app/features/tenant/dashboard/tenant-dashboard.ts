import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Placeholder tenant dashboard for the Auth pass — proves the guard chain and
 * post-login redirect work end to end. Full applications tracker + saved
 * rooms UI ports in with the Sprint 3 portal pass.
 */
@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="font-family:sans-serif;padding:2rem;max-width:640px;margin:0 auto">
      <h1>Welcome, {{ auth.user()?.fullName }} 👋</h1>
      <p>Tenant dashboard — applications tracker ships in the next pass.</p>
      <button (click)="auth.logout()">Log out</button>
    </div>
  `,
})
export class TenantDashboard {
  auth = inject(AuthService);
}
