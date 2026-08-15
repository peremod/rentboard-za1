import { describe, it, expect } from 'vitest';
import { ZarCentsPipe } from './zar-cents.pipe';

/**
 * Smoke test for the cents->Rand rendering contract.
 * This pipe is the only sanctioned way to display rentCents/depositCents,
 * so a regression here would mis-price every listing on the board.
 */
describe('ZarCentsPipe', () => {
  const pipe = new ZarCentsPipe();

  it('renders cents as whole Rand', () => {
    // R5,500.00 stored as 550000 cents
    expect(pipe.transform(550000)).toContain('5');
    expect(pipe.transform(550000)).toContain('500');
  });

  it('appends /mo for the monthly variant', () => {
    expect(pipe.transform(550000, 'monthly')).toContain('/mo');
  });

  it('returns an empty string for null or undefined', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });

  it('does not lose precision on small amounts', () => {
    expect(pipe.transform(10000)).toContain('100');
  });
});
