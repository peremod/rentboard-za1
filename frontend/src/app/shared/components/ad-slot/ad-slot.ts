import { ChangeDetectionStrategy, Component, Injector, afterNextRender, inject, input, signal } from '@angular/core';
import { AdsService, Ad, AdPlacement } from '../../../core/services/ads.service';

/**
 * A single ad placement.
 *
 * Renders nothing when there is no ad, so it can be dropped anywhere without
 * leaving a hole in the layout.
 *
 * The "Advertisement" label is not optional decoration. The CPA requires
 * advertising to be identifiable as such, and on a platform where people are
 * deciding who to trust with a deposit, an ad that reads like a listing is
 * actively dangerous.
 */
@Component({
  selector: 'app-ad-slot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ad(); as advert) {
      <aside class="ad-slot" [class]="'ad-slot--' + placement()">
        <span class="ad-slot__label">Advertisement</span>

        <a class="ad-slot__link" [href]="clickUrl(advert)"
           target="_blank" rel="noopener noreferrer sponsored">
          @if (advert.imagePath) {
            <img class="ad-slot__image" [src]="advert.imagePath" [alt]="advert.headline"
                 width="300" height="160" loading="lazy"/>
          }
          <div class="ad-slot__body">
            <h4 class="ad-slot__headline">{{ advert.headline }}</h4>
            @if (advert.body) { <p class="ad-slot__text">{{ advert.body }}</p> }
            <span class="ad-slot__cta">{{ advert.ctaLabel }} →</span>
            <span class="ad-slot__advertiser">by {{ advert.advertiser }}</span>
          </div>
        </a>
      </aside>
    }
  `,
  styles: [`
    .ad-slot { border: 1px solid var(--border); border-radius: var(--r12);
               background: var(--card); overflow: hidden; margin-bottom: 1.25rem; }
    .ad-slot__label { display: block; font-size: .62rem; font-weight: 700;
                      text-transform: uppercase; letter-spacing: .1em;
                      color: var(--slate); padding: .45rem .75rem 0; }
    .ad-slot__link { display: block; text-decoration: none; color: inherit; }
    .ad-slot__image { width: 100%; height: auto; object-fit: cover; margin-top: .45rem; }
    .ad-slot__body { padding: .75rem; }
    .ad-slot__headline { font-size: .9rem; font-weight: 700; color: var(--ink); margin-bottom: .3rem; }
    .ad-slot__text { font-size: .8rem; line-height: 1.6; color: var(--ink2); margin-bottom: .5rem; }
    .ad-slot__cta { font-size: .8rem; font-weight: 600; color: var(--terra); }
    .ad-slot__advertiser { display: block; font-size: .68rem; color: var(--slate); margin-top: .4rem; }
    .ad-slot--board_inline { margin-bottom: 0; height: 100%; }
  `],
})
export class AdSlot {
  private ads = inject(AdsService);

  readonly placement = input.required<AdPlacement>();
  readonly province = input<string | undefined>(undefined);
  readonly city = input<string | undefined>(undefined);
  readonly roomType = input<string | undefined>(undefined);

  ad = signal<Ad | null>(null);
  private injector = inject(Injector);

  constructor() {
    // Deliberately NOT ngOnInit. The board is prerendered, so ngOnInit runs at
    // build time against an empty database and that empty result gets baked
    // into the HTML — hydration does not re-run it, so no ad ever appeared.
    // afterNextRender only runs in the browser, against the live API.
    afterNextRender(() => this.load(), { injector: this.injector });
  }

  private load() {
    this.ads
      .getAds(this.placement(), {
        province: this.province(),
        city: this.city(),
        roomType: this.roomType(),
      })
      .subscribe({
        next: (ads) => {
          const first = ads[0] ?? null;
          this.ad.set(first);
          if (first) this.ads.recordImpressions([first.id]);
        },
        // An ad failing must never affect the page it sits on.
        error: () => this.ad.set(null),
      });
  }

  clickUrl(ad: Ad) {
    return this.ads.clickUrl(ad);
  }
}
