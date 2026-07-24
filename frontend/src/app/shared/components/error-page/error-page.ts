import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="min-height:60vh;display:flex;align-items:center;justify-content:center;text-align:center;font-family:sans-serif">
      <div>
        <h2>Page not found</h2>
        <p><a routerLink="/">Back to home</a></p>
      </div>
    </div>
  `,
})
export class ErrorPage {}
