import { describe, it, expect } from 'vitest';
import { signaturesMatch } from './payfast.service';

/**
 * F-03. The PayFast ITN signature used to be compared with `!==`, which leaks
 * match length through timing. `signaturesMatch` is the constant-time compare
 * that replaced it, matching the house pattern used by every other signature
 * and OTP check. These cases pin its contract; neutering it (returning `true`,
 * or dropping the length guard) turns the mismatch cases red, so the check can
 * fail — which is the whole point of lifting it out as a pure function.
 */
describe('signaturesMatch', () => {
  const sig = 'a'.repeat(32); // shape of an MD5 hex digest

  it('accepts two identical signatures', () => {
    expect(signaturesMatch(sig, sig)).toBe(true);
    expect(signaturesMatch('0f1e2d3c4b5a6978', '0f1e2d3c4b5a6978')).toBe(true);
  });

  it('rejects a one-character difference of equal length', () => {
    expect(signaturesMatch('a'.repeat(31) + 'b', sig)).toBe(false);
    expect(signaturesMatch('b' + 'a'.repeat(31), sig)).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    expect(() => signaturesMatch('a'.repeat(31), sig)).not.toThrow();
    expect(signaturesMatch('a'.repeat(31), sig)).toBe(false);
    expect(signaturesMatch(sig, '')).toBe(false);
    expect(signaturesMatch('', '')).toBe(true);
  });
});
