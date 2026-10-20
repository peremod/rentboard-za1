import { parseSearchPhrase, KnownPlace } from '../src/modules/rooms/search-phrase';

// The places that actually have live listings in development.
const PLACES: KnownPlace[] = [
  { city: 'Pretoria', province: 'Gauteng' },
  { city: 'Johannesburg', province: 'Gauteng' },
  { city: 'Sandton', province: 'Gauteng' },
  { city: 'Rosebank', province: 'Gauteng' },
  { city: 'Springs', province: 'Gauteng' },
  { city: 'Cape Town', province: 'Western Cape' },
];

type Expect = { city?: string; province?: string; roomType?: string; tokens?: string[]; empty?: boolean };
const cases: Array<[string, Expect]> = [
  ['rooms to rent in Springs',                 { city: 'Springs', tokens: [] }],
  ['Accommodation in Johannesburg',            { city: 'Johannesburg', tokens: [] }],
  ['Rooms available in Pretoria',              { city: 'Pretoria', tokens: [] }],
  ['Affordable student accommodation in Gauteng', { province: 'Gauteng', tokens: ['affordable', 'student'] }],
  ['Single rooms to rent',                     { tokens: ['single'] }],
  ['Shared accommodation near me',             { roomType: 'shared_house', tokens: [] }],
  ['Properties available for rent in Soweto',  { tokens: ['soweto'] }],
  ['studio in Cape Town',                      { city: 'Cape Town', roomType: 'studio', tokens: [] }],
  ['bachelor flat pretoria',                   { city: 'Pretoria', roomType: 'studio', tokens: ['flat'] }],
  ['  EN-SUITE   in   SANDTON  ',              { city: 'Sandton', roomType: 'en_suite', tokens: [] }],
  ['rooms!!! to rent, in @Pretoria.',          { city: 'Pretoria', tokens: [] }],
  ['in the',                                   { empty: true }],
  ['',                                         { empty: true }],
  ['Springside',                               { tokens: ['springside'] }],   // must NOT match Springs
];

let bad = 0;
for (const [phrase, want] of cases) {
  const got: any = parseSearchPhrase(phrase, PLACES);
  const checks: string[] = [];
  let ok = true;
  for (const k of ['city', 'province', 'roomType', 'empty'] as const) {
    if (want[k] !== undefined && got[k] !== want[k]) { ok = false; checks.push(`${k}: want ${want[k]} got ${got[k]}`); }
  }
  if (want.tokens && JSON.stringify(got.tokens) !== JSON.stringify(want.tokens)) {
    ok = false; checks.push(`tokens: want ${JSON.stringify(want.tokens)} got ${JSON.stringify(got.tokens)}`);
  }
  if (!ok) bad++;
  const summary = [got.city && `city=${got.city}`, got.province && `prov=${got.province}`,
                   got.roomType && `type=${got.roomType}`, `tokens=${JSON.stringify(got.tokens)}`]
                  .filter(Boolean).join(' ');
  console.log(`${ok ? '  ✅' : '  ❌'} ${JSON.stringify(phrase).padEnd(46)} ${summary}${checks.length ? '  <-- ' + checks.join('; ') : ''}`);
}
console.log(bad ? `\n${bad} of ${cases.length} wrong` : `\nall ${cases.length} parsed as intended`);
process.exit(bad ? 1 : 0);
