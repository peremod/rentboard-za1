import { Pipe, PipeTransform } from '@angular/core';

/**
 * Renders ZAR cents (integer) as a formatted Rand string using en-ZA locale.
 * Usage: {{ room.rentCents | zarCents }}              → "R 5,500"
 *        {{ room.rentCents | zarCents:'monthly' }}     → "R 5,500/mo"
 */
@Pipe({ name: 'zarCents', standalone: true })
export class ZarCentsPipe implements PipeTransform {
  private formatter = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  });

  transform(cents: number | null | undefined, suffix?: 'monthly'): string {
    if (cents == null) return '';
    const formatted = this.formatter.format(cents / 100);
    return suffix === 'monthly' ? `${formatted}/mo` : formatted;
  }
}
