/**
 * One canonical form for South African mobile numbers: +27821234567.
 *
 * Shared because storing two forms of the same number is how phone sign-in
 * silently broke — verification wrote '+2763...' while saving the profile
 * wrote back '063...' from the form, and the lookup stopped matching a number
 * the user had just verified.
 */
export function normaliseSaMobile(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^0[6-8]\d{8}$/.test(digits)) return `+27${digits.slice(1)}`;
  if (/^\+27[6-8]\d{8}$/.test(digits)) return digits;
  if (/^27[6-8]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}
