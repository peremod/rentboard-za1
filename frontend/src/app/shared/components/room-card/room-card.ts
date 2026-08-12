import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Room } from '../../../core/models/room.model';
import { ZarCentsPipe } from '../../pipes/zar-cents.pipe';

/**
 * Room card — the notice-board grid item.
 * NgOptimizedImage + [priority]="isFirstCard()" handles the LCP image
 * (loading="eager"/fetchpriority="high") automatically; every other card
 * lazy-loads. width/height are fixed to prevent CLS.
 *
 * IMPORTANT: `ngSrc` gets the *raw* stored path (or the local placeholder,
 * starting with '/'), never a pre-built ImageKit URL — the app-wide
 * IMAGE_LOADER (app.config.ts) is what applies the CDN transform. Passing
 * an already-transformed URL here would run it through the loader twice.
 */
@Component({
  selector: 'app-room-card',
  standalone: true,
  imports: [NgOptimizedImage, RouterLink, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="room-card" [routerLink]="['/rooms', room().id]">
      <div class="room-card__image-wrap">
        <img
          [ngSrc]="heroPath()"
          [alt]="room().title"
          width="600" height="400"
          [priority]="isFirstCard()"
        />
        @if (room().isFeatured) { <span class="room-card__badge">⭐ Featured</span> }
      </div>
      <div class="room-card__body">
        <div class="room-card__price">
          {{ room().rentCents | zarCents:'monthly' }}
          @if (room().billsIncluded) { <span class="room-card__bills">Bills incl.</span> }
        </div>
        <h3 class="room-card__title">{{ room().title }}</h3>
        <p class="room-card__location">{{ room().locationDisplay }}</p>
        <div class="room-card__flags">
          @if (room().couplesAllowed) { <span>Couples ✓</span> }
          @if (room().dssAccepted) { <span>DSS/SASSA ✓</span> }
          @if (room().guarantorAccepted) { <span>Guarantor ✓</span> }
          @if (room().petsAllowed) { <span>Pets ✓</span> }
        </div>
      </div>
    </article>
  `,
  styles: [`
    .room-card { display: block; background: #FDFAF4; border: 1px solid #DDD5C8; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; cursor: pointer; transition: transform .15s, box-shadow .15s; }
    .room-card:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(28,22,14,.12); }
    .room-card__image-wrap { position: relative; background: #F2EDE3; }
    .room-card__image-wrap img { width: 100%; height: auto; display: block; }
    .room-card__badge { position: absolute; top: .6rem; left: .6rem; background: #D4A853; color: #fff; font-size: .65rem; font-weight: 700; padding: .2rem .5rem; border-radius: 20px; }
    .room-card__body { padding: .9rem; }
    .room-card__price { font-family: monospace; font-size: 1.05rem; font-weight: 700; color: #C04E28; margin-bottom: .2rem; }
    .room-card__bills { font-family: sans-serif; font-size: .62rem; font-weight: 700; background: rgba(61,112,64,.12); color: #3D7040; padding: .1rem .4rem; border-radius: 20px; margin-left: .4rem; }
    .room-card__title { font-size: .88rem; font-weight: 600; margin-bottom: .3rem; }
    .room-card__location { font-size: .78rem; color: #7A6E60; margin-bottom: .6rem; }
    .room-card__flags { display: flex; gap: .35rem; flex-wrap: wrap; }
    .room-card__flags span { font-size: .65rem; font-weight: 700; background: rgba(61,112,64,.1); color: #3D7040; padding: .12rem .42rem; border-radius: 20px; }
  `],
})
export class RoomCard {
  room = input.required<Room>();
  /** First card in the grid — gets eager/high-priority image loading (LCP). */
  isFirstCard = input(false);
  saved = output<string>();

  heroPath = computed(() => this.room().heroImagePath || '/assets/images/room-placeholder.svg');
}
