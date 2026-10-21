import { describe, it, expect } from 'vitest';
import { VERIFICATION_RULES, typesFor, maySubmit, requiresPayment } from './verification.rules';

/**
 * Who may prove what, and who pays for it.
 *
 * ⚠️ `requiresPayment` is the standing constraint of this product expressed
 * as a function. "Free to list, free to apply" is the whole position against
 * RoomKing, AmaRoom, Gumtree and Facebook, and the only fee in the system is
 * a landlord's own identity check. A test that lets a tenant-side type start
 * charging would be the most expensive green tick in the repository.
 */

const TYPES = Object.keys(VERIFICATION_RULES) as Array<keyof typeof VERIFICATION_RULES>;

describe('requiresPayment', () => {
  it('charges a landlord for an identity check, and nothing else', () => {
    expect(requiresPayment('identity', 'LANDLORD')).toBe(true);
  });

  it('never charges a TENANT for anything', () => {
    // Exhaustive over the real rule set rather than a list retyped here: a
    // new verification type is covered by this the day it is added.
    for (const type of TYPES) {
      expect({ type, paid: requiresPayment(type, 'TENANT') })
        .toEqual({ type, paid: false });
    }
  });

  it('never charges a landlord for anything except identity', () => {
    for (const type of TYPES.filter((t) => t !== 'identity')) {
      expect({ type, paid: requiresPayment(type, 'LANDLORD') })
        .toEqual({ type, paid: false });
    }
  });

  it('does not charge for sublet_right — a listing fee under another name', () => {
    // A sub-lessor is a landlord listing a room, and listing is free. It is
    // also the check that protects the APPLICANT.
    expect(requiresPayment('sublet_right', 'LANDLORD')).toBe(false);
  });
});

describe('maySubmit', () => {
  it('lets a landlord submit a landlord-subject type', () => {
    expect(maySubmit('proof_of_ownership', 'LANDLORD')).toBe(true);
  });

  it('refuses a tenant a landlord-subject type', () => {
    expect(maySubmit('proof_of_ownership', 'TENANT')).toBe(false);
  });

  it('allows either role a shared type', () => {
    const shared = TYPES.filter((t) => VERIFICATION_RULES[t].subject === 'BOTH');
    expect(shared.length).toBeGreaterThan(0);
    for (const type of shared) {
      expect(maySubmit(type, 'LANDLORD')).toBe(true);
      expect(maySubmit(type, 'TENANT')).toBe(true);
    }
  });

  it('refuses a type that does not exist rather than throwing', () => {
    expect(maySubmit('not_a_type' as any, 'TENANT')).toBe(false);
  });

  it('agrees with the rule table for every type and both roles', () => {
    // The guarantee: maySubmit is the rule table, not a second opinion on it.
    for (const type of TYPES) {
      const subject = VERIFICATION_RULES[type].subject;
      expect(maySubmit(type, 'LANDLORD')).toBe(subject === 'BOTH' || subject === 'LANDLORD');
      expect(maySubmit(type, 'TENANT')).toBe(subject === 'BOTH' || subject === 'TENANT');
    }
  });
});

describe('typesFor', () => {
  it('hides sublet_right from somebody with no sublet listing', () => {
    expect(typesFor('LANDLORD', false)).not.toContain('sublet_right');
  });

  it('offers it once they have one', () => {
    expect(typesFor('LANDLORD', true)).toContain('sublet_right');
  });

  it('defaults to hiding it, which is the common case', () => {
    expect(typesFor('LANDLORD')).toEqual(typesFor('LANDLORD', false));
  });

  /**
   * ⚠️ The list is a UI convenience; `maySubmit` is the gate. A type absent
   * from the list may still be submitted, because the submission is checked
   * against a real listing the person owns — a stronger check than this one.
   * Asserted so nobody later "fixes" the list into a permission boundary.
   */
  it('is narrower than maySubmit, and that is deliberate', () => {
    expect(typesFor('LANDLORD', false)).not.toContain('sublet_right');
    expect(maySubmit('sublet_right', 'LANDLORD')).toBe(true);
  });

  it('never offers a role a type it may not submit', () => {
    for (const role of ['LANDLORD', 'TENANT'] as const) {
      for (const type of typesFor(role, true)) {
        expect({ role, type, allowed: maySubmit(type, role) })
          .toEqual({ role, type, allowed: true });
      }
    }
  });
});
