import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Shimmer loading placeholder — matches RoomCard's exact dimensions to prevent CLS while data loads. */
@Component({
  selector: 'app-skeleton-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="skeleton-card" aria-busy="true" aria-label="Loading room listing">
      <div class="skeleton-card__image shimmer"></div>
      <div class="skeleton-card__body">
        <div class="shimmer" style="height:18px;width:40%;border-radius:4px"></div>
        <div class="shimmer" style="height:14px;width:80%;border-radius:4px;margin-top:.5rem"></div>
        <div class="shimmer" style="height:12px;width:55%;border-radius:4px;margin-top:.4rem"></div>
      </div>
    </div>
  `,
  styles: [`
    .skeleton-card { background: #FDFAF4; border: 1px solid #DDD5C8; border-radius: 12px; overflow: hidden; }
    .skeleton-card__image { height: 200px; background: #F2EDE3; }
    .skeleton-card__body { padding: .9rem; }
    .shimmer { background: linear-gradient(90deg, #F2EDE3 25%, #E8DFD0 50%, #F2EDE3 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  `],
})
export class SkeletonCard {}
