import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-landlord-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="font-family:sans-serif;padding:2rem;max-width:640px;margin:0 auto">
      <h1>Welcome, {{ auth.user()?.fullName }} 👋</h1>
      <p>Landlord dashboard — room listings + applicant manager ship in the next pass.</p>
      <button (click)="auth.logout()">Log out</button>
    </div>
  `,
})
export class LandlordDashboard {
  auth = inject(AuthService);
}
