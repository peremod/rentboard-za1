import {
  ChangeDetectionStrategy, Component, OnInit, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { StorefrontService } from '../../../core/services/storefront.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { MyStorefront } from '../../../core/models/storefront.model';
import { PortalShell } from '../../../shared/components/portal-shell/portal-shell';
import { landlordNav } from '../landlord-nav';

/**
 * The landlord's own view of their public page — Phase 5b.
 *
 * ── Off until they turn it on
 *
 * A page about a person, indexable by Google, is not something to create on
 * their behalf. The slug is minted when they first open this screen so the URL
 * exists to show them, and `storefrontLive` stays false until they press the
 * switch. Nothing reaches the sitemap before that.
 *
 * ── The address is shown and is not editable
 *
 * Shown, because a landlord sharing a link needs to know what it is. Not
 * editable, because it is in the sitemap and in whatever anyone has already
 * shared — changing it would 404 every link that pointed at the page, and the
 * landlord who renamed it would be the last to find out. A rename needs a
 * redirect table, which is a bigger thing than this screen.
 */
@Component({
  selector: 'app-storefront-settings',
  standalone: true,
  imports: [FormsModule, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Landlord" pageTitle="Your public page">

      <div class="insight-banner">
        🪧
        <span>
          This is a page tenants can find on Google. It shows your name, your
          verified badge, and the rooms you have on the board — nothing about
          your tenants, your rent records or your expenses.
        </span>
      </div>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (store(); as s) {

        <section class="dash-section">
          <h2 class="dash-section-title">Its address</h2>
          @if (s.slug) {
            <p class="store-url"><code>{{ siteUrl }}/landlords/{{ s.slug }}</code></p>
            <p class="muted">
              This cannot be changed. It is the address you will share and the one
              Google will remember, so it stays the same.
            </p>
          } @else {
            <p class="muted">No address yet — reload this page to have one made.</p>
          }
        </section>

        <section class="dash-section">
          <h2 class="dash-section-title">
            {{ s.storefrontLive ? 'It is live' : 'It is not live yet' }}
          </h2>
          <p class="muted">
            @if (s.storefrontLive) {
              Anyone with the link can see it, and Google can find it.
            } @else {
              Nobody can see it. Nothing about you is public until you switch it on.
            }
          </p>
          <button type="button" class="btn"
                  [class.btn-primary]="!s.storefrontLive"
                  [class.btn-outline]="s.storefrontLive"
                  [disabled]="saving()"
                  (click)="togglePublished(s)">
            {{ s.storefrontLive ? 'Take it down' : 'Put it online' }}
          </button>
          @if (s.storefrontLive) {
            <a class="btn btn-outline" [href]="'/landlords/' + s.slug" target="_blank" rel="noopener">
              See it as a tenant would ↗
            </a>
          }
        </section>

        <section class="dash-section">
          <h2 class="dash-section-title">About you</h2>
          <label class="field">
            <span class="field-label">In your own words (optional)</span>
            <textarea [(ngModel)]="bio" name="bio" rows="4" maxlength="600"
                      placeholder="I have rented rooms in this yard for eleven years. The gate is locked at nine."></textarea>
          </label>
          <p class="muted">
            {{ bio.length }} of 600 characters. Tenants see this as your own
            words — we do not check it, and the page says so.
          </p>

          <label class="field">
            <span class="field-label">A photo or logo (optional)</span>
            <input type="file" accept="image/jpeg,image/png,image/webp"
                   [disabled]="uploading()" (change)="pickLogo($event)"/>
          </label>
          @if (uploading()) { <p class="muted" role="status">Uploading…</p> }
          @if (uploadError()) { <p class="field-error" role="alert">{{ uploadError() }}</p> }

          <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
          @if (saved()) { <p class="muted" role="status">Saved.</p> }
        </section>

        <section class="dash-section">
          <h2 class="dash-section-title">Your badges</h2>
          <p class="muted">
            These are worked out from what you have actually done here — you
            cannot set them, and neither can we on request. Being verified is the
            one that changes how tenants treat a listing.
          </p>
          @if (!s.idVerified) {
            <p class="muted">
              You are not verified yet, so your page does not carry that badge.
            </p>
          }
        </section>
      }
    </app-portal-shell>
  `,
  styles: [
    `
      .store-url { overflow-wrap: anywhere; }
      .store-url code { font-size: 0.9rem; }
      .dash-section .btn { margin-right: 0.5rem; }
    `,
  ],
})
export class StorefrontSettings implements OnInit {
  private service = inject(StorefrontService);
  private uploads = inject(UploadsService);

  navItems = landlordNav();
  readonly siteUrl = environment.siteUrl;

  readonly store = signal<MyStorefront | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  bio = '';
  private logoPath: string | null | undefined = undefined;

  ngOnInit() {
    this.service.mine().subscribe({
      next: (s) => {
        this.store.set(s);
        this.bio = s.bio ?? '';
        this.loading.set(false);
      },
      // Silent: the interceptor reports it, and saying it twice is a defect this
      // codebase has already shipped once.
      error: () => this.loading.set(false),
    });
  }

  async pickLogo(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploadError.set(null);
    this.uploading.set(true);
    try {
      // NOT uploadPrivate: this image is on a page whose entire purpose is being
      // seen, unlike a verification document.
      const { path } = await this.uploads.uploadImage(file, 'storefronts');
      this.logoPath = path;
      this.uploading.set(false);
      input.value = '';
      // Saved immediately rather than waiting for the Save button: a landlord
      // who uploads a photo and navigates away would otherwise lose it with no
      // sign that anything was pending.
      this.save();
    } catch (e) {
      this.uploadError.set(e instanceof Error ? e.message : 'The upload failed. Try again.');
      this.uploading.set(false);
    }
  }

  save() {
    this.saving.set(true);
    this.saved.set(false);
    this.service
      .updateMine({
        bio: this.bio,
        ...(this.logoPath === undefined ? {} : { logoPath: this.logoPath }),
      })
      .subscribe({
        next: (s) => {
          this.store.set(s);
          this.saving.set(false);
          this.saved.set(true);
        },
        error: () => this.saving.set(false),
      });
  }

  togglePublished(current: MyStorefront) {
    this.saving.set(true);
    this.service.updateMine({ storefrontLive: !current.storefrontLive }).subscribe({
      next: (s) => {
        this.store.set(s);
        this.saving.set(false);
      },
      error: () => this.saving.set(false),
    });
  }
}
