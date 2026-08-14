import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';

/**
 * Usage: {{ 'nav.browse_rooms' | translate }}
 *        {{ 'found_rooms' | translate:{ count: results.length } }}
 *
 * Deliberately impure (`pure: false`) and reads i18n.currentLang() as part
 * of transform — that registers the pipe as a dependent of the language
 * signal, so every instance across the app re-renders when setLanguage()
 * is called, without each component needing its own subscription plumbing.
 */
@Pipe({ name: 'translate', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(key: string, params?: Record<string, string | number>): string {
    this.i18n.currentLang(); // signal read — see docblock above
    return this.i18n.translate(key, params);
  }
}
