import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * One stroke icon, from one set, at one weight.
 *
 * ⚠️ This exists because 51 rendered templates used EMOJI as icons across
 * 340 occurrences — 137 in the landlord yard alone — and emoji are not an
 * icon set. They are full-colour glyphs drawn by the device: a different
 * picture on a Samsung, a Pixel and an iPhone, at a different optical
 * weight each, with no way to size, align or recolour them. A column of
 * them down a sidebar is the single loudest "assembled quickly" signal
 * the product had, and it was reported as exactly that.
 *
 * Lucide geometry (ISC), transcribed as path data and served from this
 * file. Nothing is fetched at runtime and no icon font is loaded: this
 * product is built for a cheap Android on a metered connection, and an
 * icon font is a blocking request for glyphs that mostly go unused.
 *
 * ⚠️ Every shape is a `path`, including the circles, because a mixed
 * `path`/`circle` map needs two renderers and the second one is where a
 * missing stroke-width hides. A circle is an arc pair: r=10 at (12,12) is
 * `M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0`.
 *
 * `currentColor` and `em` sizing, so an icon takes the colour and the
 * size of the text it sits beside and cannot drift from it.
 */
const ICONS: Record<string, string[]> = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  search: ['M19 11a8 8 0 1 1-16 0 8 8 0 1 1 16 0', 'm21 21-4.3-4.3'],
  globe: [
    'M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0',
    'M2 12h20',
    'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  ],
  'map-pin': ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M15 10a3 3 0 1 1-6 0 3 3 0 1 1 6 0'],
  calendar: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  home: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  heart: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  'file-text': ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v5h5', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M13 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0'],
  chart: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-4'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  building: ['M3 21h18', 'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16', 'M9 7h1', 'M9 11h1', 'M9 15h1', 'M14 7h1', 'M14 11h1', 'M14 15h1'],
  ban: ['M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0', 'm4.9 4.9 14.2 14.2'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  edit: ['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z'],
  'id-card': ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M14 10a2 2 0 1 1-4 0 2 2 0 1 1 4 0', 'M8 16a4 4 0 0 1 8 0'],
  sliders: ['M21 4H14', 'M10 4H3', 'M21 12H12', 'M8 12H3', 'M21 20H16', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'],
  check: ['M20 6 9 17l-5-5'],
  star: ['m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
};

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         [attr.aria-hidden]="label() ? null : 'true'"
         [attr.role]="label() ? 'img' : null"
         [attr.aria-label]="label() || null"
         focusable="false">
      @for (d of paths(); track d) {
        <path [attr.d]="d"/>
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      /* 1em square, so it matches the text beside it at every size without
         a modifier class per context. The optical correction is -.05em on
         the baseline, which is what stops an icon sitting a hair high in a
         button label. */
      .icon {
        width: 1em;
        height: 1em;
        vertical-align: -0.05em;
      }
    `,
  ],
})
export class Icon {
  /** A key of the set above. An unknown name renders nothing, loudly — see below. */
  name = input.required<string>();

  /**
   * Set this ONLY when the icon is the whole control and carries its own
   * meaning. Beside a word it must stay aria-hidden, or a screen reader
   * reads the label twice.
   */
  label = input<string>('');

  paths = computed(() => {
    const found = ICONS[this.name()];
    if (!found) {
      // ⚠️ Not a silent empty. A typo'd name used to be the shape of defect
      // this repo keeps producing — a control that renders as nothing and
      // reads as a layout bug. The console names the icon and the set.
      console.warn(
        `[app-icon] no icon named "${this.name()}". Known: ${Object.keys(ICONS).sort().join(', ')}`,
      );
      return [];
    }
    return found;
  });
}
