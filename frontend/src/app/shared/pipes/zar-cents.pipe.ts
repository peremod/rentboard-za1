import { Pipe, PipeTransform } from '@angular/core';

/**
 * Renders ZAR cents (integer) as a formatted Rand string using en-ZA locale.
 * Usage: {{ room.rentCents | zarCents }}              → "R 5,500"
 *        {{ room.rentCents | zarCents:'monthly' }}     → "R 5,500/mo"
 *        {{ expense.amountCents | zarCents:'exact' }}  → "R 450.50"
 *
 * ── Why 'exact' exists
 *
 * The default rounds to whole rand, which is right for rent: rents in this
 * market are whole numbers and "R 5,500" reads better than "R 5,500.00" on a
 * card a tenant skims.
 *
 * It is wrong for expenses. A landlord types a municipal bill of R450.50 and
 * the screen said "R 451", while the CSV export — which an accountant uses —
 * said 450.50. The rows visibly did not add up to the total shown above them,
 * which is the fastest way to make someone stop trusting a money screen.
 * Found by driving the form with 450.50 rather than a round number.
 */
@Pipe({ name: 'zarCents', standalone: true })
export class ZarCentsPipe implements PipeTransform {
  private rounded = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  });

  private exact = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  transform(cents: number | null | undefined, suffix?: 'monthly' | 'exact'): string {
    if (cents == null) return '';
    if (suffix === 'exact') return this.exact.format(cents / 100);
    const formatted = this.rounded.format(cents / 100);
    return suffix === 'monthly' ? `${formatted}/mo` : formatted;
  }
}
