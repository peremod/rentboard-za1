import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="max-width:360px;margin:3rem auto;font-family:sans-serif">
      <h1>Create your free account</h1>
      <p>Free to list. Free to apply. Always.</p>

      <div>
        <button type="button" [class.active]="role() === 'TENANT'" (click)="role.set('TENANT')">
          I'm looking for a room
        </button>
        <button type="button" [class.active]="role() === 'LANDLORD'" (click)="role.set('LANDLORD')">
          I have a room to let
        </button>
      </div>

      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <label>Full name<br/><input type="text" formControlName="fullName"/></label><br/>
        <label>Email address<br/><input type="email" formControlName="email"/></label><br/>
        <label>Password<br/><input type="password" formControlName="password"/></label><br/>
        @if (error()) { <p style="color:#D63B3B">{{ error() }}</p> }
        <button type="submit" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Creating account…' : 'Create account free' }}
        </button>
      </form>
      <p style="font-size:.8rem">
        By registering you agree to our Terms and Privacy Policy. Your data is protected under POPIA.
      </p>
      <p>Already have an account? <a routerLink="/auth/login">Log in</a></p>
    </div>
  `,
})
export class Register {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  role = signal<'TENANT' | 'LANDLORD'>('TENANT');
  loading = signal(false);
  error = signal<string | null>(null);

  form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.register({ ...(this.form.getRawValue() as any), role: this.role() }).subscribe({
      next: (res) => this.router.navigate([res.user.role === 'LANDLORD' ? '/landlord/dashboard' : '/tenant/dashboard']),
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Something went wrong. Please try again.');
      },
    });
  }
}
