import { Pipe, PipeTransform } from '@angular/core';

/**
 * "1 room", "2 rooms" — the count and the correctly pluralised noun.
 *
 *   {{ 1 | plural: 'room' }}          → "1 room"
 *   {{ 4 | plural: 'room' }}          → "4 rooms"
 *   {{ 1 | plural: 'person':'people' }} → "1 person"
 *
 * A pipe rather than a fourth copy of `room{{ n === 1 ? '' : 's' }}`. That
 * ternary was already inline in two templates and MISSING from two others, so
 * the board read "1 rooms" while the admin screen read "1 room" — the same
 * defect this project keeps finding in other forms: a rule applied by hand is
 * a rule applied inconsistently.
 *
 * Only the count is rendered with the noun, because every site that needed
 * this was rendering both.
 */
@Pipe({ name: 'plural', standalone: true })
export class PluralPipe implements PipeTransform {
  transform(count: number | null | undefined, singular: string, plural?: string): string {
    const n = count ?? 0;
    // -1 is not a count anyone displays, but Math.abs keeps the pipe honest
    // rather than rendering "-1 rooms" as a special case nobody thought about.
    const word = Math.abs(n) === 1 ? singular : (plural ?? `${singular}s`);
    return `${n} ${word}`;
  }
}
