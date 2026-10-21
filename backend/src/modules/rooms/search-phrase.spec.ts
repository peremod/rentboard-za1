import { describe, it, expect } from 'vitest';
import { parseSearchPhrase, KnownPlace } from './search-phrase';

/**
 * Reading a typed phrase as words.
 *
 * Replaces backend/scripts/search-phrase-drive.ts, which asserted the same
 * things from a hand-rolled table and had to be run by hand. Two checks of
 * one rule drift apart; this one runs in CI.
 *
 * Places are passed in, so the suite never touches a database.
 */
const PLACES: KnownPlace[] = [
  { city: 'Pretoria', province: 'Gauteng' },
  { city: 'Johannesburg', province: 'Gauteng' },
  { city: 'Sandton', province: 'Gauteng' },
  { city: 'Springs', province: 'Gauteng' },
  { city: 'Cape Town', province: 'Western Cape' },
];

describe('parseSearchPhrase', () => {
  it('reads a place out of a natural phrase', () => {
    // The defect this exists for: as one literal substring this matched 0 of
    // 100 Johannesburg rooms.
    expect(parseSearchPhrase('Accommodation in Johannesburg', PLACES))
      .toMatchObject({ city: 'Johannesburg', tokens: [] });
  });

  it('drops the words that describe every listing equally', () => {
    // "rooms to rent in" carries no signal on a board of rooms to rent.
    expect(parseSearchPhrase('rooms to rent in Springs', PLACES))
      .toMatchObject({ city: 'Springs', tokens: [] });
  });

  it('reads a room type, in the spellings people actually use', () => {
    expect(parseSearchPhrase('en-suite in Sandton', PLACES))
      .toMatchObject({ city: 'Sandton', roomType: 'en_suite' });
    // 'bachelor' is the South African word for a studio.
    expect(parseSearchPhrase('bachelor flat pretoria', PLACES))
      .toMatchObject({ city: 'Pretoria', roomType: 'studio', tokens: ['flat'] });
  });

  it('keeps a multi-word place together', () => {
    expect(parseSearchPhrase('studio in Cape Town', PLACES))
      .toMatchObject({ city: 'Cape Town', roomType: 'studio', tokens: [] });
  });

  it('reads a province when no city is named', () => {
    expect(parseSearchPhrase('Affordable student accommodation in Gauteng', PLACES))
      .toMatchObject({ province: 'Gauteng', tokens: ['affordable', 'student'] });
  });

  it('matches whole words only', () => {
    // "Springside" must not be read as "Springs", or a search for one suburb
    // silently becomes a search for a different town.
    expect(parseSearchPhrase('Springside', PLACES).city).toBeUndefined();
    expect(parseSearchPhrase('Springside', PLACES).tokens).toEqual(['springside']);
  });

  it('survives punctuation, casing and runs of whitespace', () => {
    expect(parseSearchPhrase('  ROOMS!!! to rent, in  @Pretoria.  ', PLACES))
      .toMatchObject({ city: 'Pretoria', tokens: [] });
    expect(parseSearchPhrase('  EN-SUITE   in   SANDTON  ', PLACES))
      .toMatchObject({ city: 'Sandton', roomType: 'en_suite' });
  });

  it('leaves an unknown place as a word, so it can still match a description', () => {
    // Soweto is a locationDisplay, not a city on this board. It must fall
    // through to token matching rather than being dropped.
    expect(parseSearchPhrase('Properties available for rent in Soweto', PLACES).tokens)
      .toEqual(['soweto']);
  });

  it.each([
    ['empty', ''],
    ['only filler', 'in the'],
    ['whitespace', '    '],
  ])('reports %s input as empty rather than matching everything', (_label, input) => {
    const parsed = parseSearchPhrase(input, PLACES);
    expect(parsed.empty).toBe(true);
    expect(parsed.tokens).toEqual([]);
  });

  it('keeps nonsense as tokens, so the search can still fail', () => {
    // The property that makes every other assertion mean something: a phrase
    // the board cannot satisfy must not quietly widen into "everything".
    const parsed = parseSearchPhrase('Zzzzqqq nonexistent place', PLACES);
    expect(parsed.empty).toBe(false);
    expect(parsed.tokens).toContain('zzzzqqq');
    expect(parsed.city).toBeUndefined();
  });

  it('works with no place list at all', () => {
    // Called before any listing exists, the phrase is still read as words.
    expect(parseSearchPhrase('studio in Pretoria', [])).toMatchObject({
      roomType: 'studio',
      tokens: ['pretoria'],
    });
  });

  it('discards single characters, which match too much to be useful', () => {
    expect(parseSearchPhrase('a b room x', PLACES).tokens).toEqual([]);
  });
});
