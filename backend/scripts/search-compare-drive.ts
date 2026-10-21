/**
 * What the board returns for a typed phrase, old search vs new.
 *
 * Runs both queries against the same live data, so the comparison is a
 * measurement rather than a claim. The OLD column is the exact clause that
 * shipped until 20 October: one literal `contains` over three fields.
 */
import { PrismaClient } from '@prisma/client';
import { parseSearchPhrase } from '../src/modules/rooms/search-phrase';

const prisma = new PrismaClient();

const PHRASES = [
  'rooms to rent in Springs',
  'Accommodation in Johannesburg',
  'Rooms available in Pretoria',
  'Affordable student accommodation in Gauteng',
  'Single rooms to rent',
  'Shared accommodation near me',
  'Properties available for rent in Soweto',
  'Johannesburg',
  'studio',
  'en-suite in Sandton',
  '   pretoria   ',
  'Zzzzz nonexistent place',
];

function oldWhere(search: string) {
  return {
    status: 'active' as const,
    OR: [
      { title: { contains: search, mode: 'insensitive' as const } },
      { description: { contains: search, mode: 'insensitive' as const } },
      { locationDisplay: { contains: search, mode: 'insensitive' as const } },
    ],
  };
}

async function main() {
  const rows = await prisma.room.groupBy({ by: ['city', 'province'], where: { status: 'active' } });
  const places = rows.map((r) => ({ city: r.city, province: r.province }));

  console.log(`\n  ${'phrase'.padEnd(46)} ${'OLD'.padStart(5)} ${'NEW'.padStart(5)}   parsed as`);
  console.log('  ' + '─'.repeat(100));

  for (const phrase of PHRASES) {
    const parsed = parseSearchPhrase(phrase, places);
    const tokenClauses = parsed.tokens.map((t) => ({
      OR: [
        { title: { contains: t, mode: 'insensitive' as const } },
        { description: { contains: t, mode: 'insensitive' as const } },
        { locationDisplay: { contains: t, mode: 'insensitive' as const } },
        { city: { contains: t, mode: 'insensitive' as const } },
        { province: { contains: t, mode: 'insensitive' as const } },
      ],
    }));
    const newWhere: any = {
      status: 'active',
      ...(parsed.roomType && { roomType: parsed.roomType }),
      ...(parsed.province && { province: parsed.province }),
      ...(parsed.city && { city: { contains: parsed.city, mode: 'insensitive' } }),
      ...(tokenClauses.length > 0 && { AND: tokenClauses }),
    };

    const [o, n] = await Promise.all([
      prisma.room.count({ where: oldWhere(phrase) as any }),
      prisma.room.count({ where: newWhere }),
    ]);
    const summary = [parsed.city && `city=${parsed.city}`, parsed.province && `prov=${parsed.province}`,
                     parsed.roomType && `type=${parsed.roomType}`,
                     parsed.tokens.length ? `tokens=${JSON.stringify(parsed.tokens)}` : '']
                    .filter(Boolean).join(' ') || '(nothing)';
    const mark = n > o ? '▲' : n === o ? ' ' : '▼';
    console.log(`  ${JSON.stringify(phrase).padEnd(46)} ${String(o).padStart(5)} ${String(n).padStart(5)} ${mark} ${summary}`);
  }
  await prisma.$disconnect();
}
main();
