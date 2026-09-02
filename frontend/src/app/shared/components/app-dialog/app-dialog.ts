import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * Renders whatever dialog the service currently holds. Mounted once, globally.
 *
 * Focus moves to the confirm button on open so a keyboard user is not left
 * behind the overlay, and Escape resolves as a cancel.
 */
@Component({
  selector: 'app-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialogs.current(); as d) {
      <div class="dlg" role="alertdialog" aria-modal="true"
           [attr.aria-labelledby]="'dlg-title-' + d.id"
           (keydown.escape)="dialogs.respond(false)">
        <div class="dlg__panel">
          <div class="dlg__icon" aria-hidden="true">{{ icon(d.tone) }}</div>
          <h2 class="dlg__title" [id]="'dlg-title-' + d.id">{{ d.title }}</h2>
          <p class="dlg__message">{{ d.message }}</p>

          <div class="dlg__actions">
            @if (d.cancelLabel) {
              <button type="button" class="btn btn-outline"
                      (click)="dialogs.respond(false)">{{ d.cancelLabel }}</button>
            }
            <button #confirmBtn type="button" class="btn btn-primary"
                    (click)="dialogs.respond(true)">{{ d.confirmLabel }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .dlg { position: fixed; inset: 0; z-index: 400; background: rgba(26,20,16,.55);
           display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
    .dlg__panel { background: #fff; border-radius: 12px; padding: 1.75rem 1.5rem;
                  max-width: 24rem; width: 100%; text-align: center;
                  box-shadow: 0 18px 44px rgba(0,0,0,.22); }
    .dlg__icon { font-size: 2rem; line-height: 1; margin-bottom: .5rem; }
    .dlg__title { font-size: 1.15rem; font-weight: 700; margin-bottom: .35rem; color: #1A1410; }
    .dlg__message { font-size: .9rem; line-height: 1.6; color: #5A5044; margin-bottom: 1.25rem; }
    .dlg__actions { display: flex; gap: .5rem; }
    .dlg__actions .btn { flex: 1; }
  `],
})
export class AppDialog {
  dialogs = inject(DialogService);
  private confirmBtn = viewChild<ElementRef<HTMLButtonElement>>('confirmBtn');

  constructor() {
    effect(() => {
      if (this.dialogs.current()) {
        // Deferred: the button does not exist until this render completes.
        setTimeout(() => this.confirmBtn()?.nativeElement.focus(), 0);
      }
    });
  }

  icon(tone: string) {
    return { success: '✅', error: '⚠️', warning: '⚠️', info: 'ℹ️' }[tone] ?? 'ℹ️';
  }
}
