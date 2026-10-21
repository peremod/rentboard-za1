import { describe, it, expect } from 'vitest';
import { normaliseSaMobile } from './phone.util';
import { escapeHtml } from './escape-html.util';
import { sanitizeText } from './sanitize.util';

/**
 * Input handling at the edges: the three functions that decide what a South
 * African mobile number IS, and what never reaches an email or the database.
 */

describe('normaliseSaMobile', () => {
  /**
   * ⚠️ Storing two forms of one number is how phone sign-in silently broke:
   * verification wrote '+2763…' while the profile form wrote back '063…',
   * and the lookup stopped matching a number the user had just verified. So
   * every spelling must land on exactly one string.
   */
  it.each([
    ['local 0-prefixed', '0821234567'],
    ['full international', '+27821234567'],
    ['international without +', '27821234567'],
    ['spaced', '082 123 4567'],
    ['dashed', '082-123-4567'],
    ['bracketed', '(082) 123 4567'],
  ])('maps %s to the one canonical form', (_label, input) => {
    expect(normaliseSaMobile(input)).toBe('+27821234567');
  });

  it('accepts every valid SA mobile prefix', () => {
    for (const p of ['6', '7', '8']) {
      expect(normaliseSaMobile(`0${p}21234567`)).toBe(`+27${p}21234567`);
    }
  });

  it.each([
    ['a landline prefix', '0211234567'],
    ['too short', '08212345'],
    ['too long', '08212345678'],
    ['letters', 'oh eight two'],
    ['empty', ''],
    ['another country', '+441234567890'],
    ['prefix 9, which SA does not issue for mobile', '0921234567'],
  ])('refuses %s', (_label, input) => {
    expect(normaliseSaMobile(input)).toBeNull();
  });

  it('is idempotent — normalising twice changes nothing', () => {
    const once = normaliseSaMobile('082 123 4567')!;
    expect(normaliseSaMobile(once)).toBe(once);
  });
});

describe('escapeHtml', () => {
  /**
   * Applied to every dynamic value in a notification template. An unescaped
   * landlord name is an injection into somebody else's inbox.
   */
  it('escapes all five characters that matter', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('escapes the ampersand first, so entities are not double-broken', () => {
    // If & were escaped last, '<' would become '&lt;' and then '&amp;lt;'.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('neutralises a script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('leaves ordinary text alone, including a South African name', () => {
    expect(escapeHtml('Thandiwe Mokoena')).toBe('Thandiwe Mokoena');
    expect(escapeHtml('')).toBe('');
  });
});

describe('sanitizeText', () => {
  it('strips every tag, keeping the readable text', () => {
    expect(sanitizeText('<b>Back room</b> in <i>Soweto</i>')).toBe('Back room in Soweto');
  });

  it('removes a script element entirely, not just its tags', () => {
    const out = sanitizeText('<script>alert(1)</script>Hello');
    expect(out).not.toContain('alert');
    expect(out).toContain('Hello');
  });

  it('drops attributes that could carry a handler', () => {
    expect(sanitizeText('<div onclick="steal()">text</div>')).toBe('text');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeText('   spaced   ')).toBe('spaced');
  });

  it('returns an empty string for markup that has no text at all', () => {
    expect(sanitizeText('<br/>')).toBe('');
  });
});
