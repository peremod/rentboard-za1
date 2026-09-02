import { environment } from '@env/environment';

export type ImageVariant = 'thumb' | 'card' | 'detail' | 'avatar' | 'ad';

const TRANSFORMS: Record<ImageVariant, string> = {
  thumb: 'tr=w-120,h-80,c-maintain_ratio,q-70,f-auto',
  card: 'tr=w-600,h-400,c-maintain_ratio,q-80,f-auto',
  detail: 'tr=w-1200,h-800,c-maintain_ratio,q-90,f-auto',
  avatar: 'tr=w-80,h-80,c-force,fo-face,q-80,f-auto',
  // Fixed 3:2 crop. Ad creatives arrive at whatever size the advertiser sends,
  // and an uncropped one would push the grid around; c-force guarantees the
  // slot is always the same shape.
  ad: 'tr=w-600,h-400,c-force,q-80,f-auto',
};

/**
 * Builds an ImageKit CDN URL from a stored file path — for plain <img [src]>
 * contexts only (avatars, galleries). NgOptimizedImage usages (RoomCard) must
 * NOT use this — they pass the raw path and let the app-wide IMAGE_LOADER
 * (app.config.ts) do the one-and-only transform, or the URL gets double-prefixed.
 */
export function getImageUrl(path: string | null | undefined, variant: ImageVariant = 'card'): string {
  if (!path) return '/assets/images/room-placeholder.svg';
  return `${environment.imagekitUrl}/${path}?${TRANSFORMS[variant]}`;
}
