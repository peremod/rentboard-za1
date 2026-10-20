#!/usr/bin/env node
/**
 * Is the GENERATED Prisma client current with schema.prisma?
 *
 * ── Why this exists
 *
 * Staging was migrated on 20 October and the survey seed then failed with six
 * TypeScript errors, all of them pointing into prisma/seed-survey.ts:
 *
 *   error TS2353: … 'slug_version' does not exist in type 'SurveyWhereUniqueInput'
 *   error TS2339: Property '_count' does not exist on type '{ id: string; … }'
 *
 * The seed script was correct. The database was correct — all 38 migrations
 * applied, including the one that adds `Survey.version` and the
 * `@@unique([slug, version])` it is read through. What was stale was
 * node_modules/.prisma/client, generated from a schema older than 16 October.
 * `prisma migrate deploy` does NOT regenerate the client (only `migrate dev`
 * does), and `postinstall` only runs on install — so pulling new code and
 * migrating leaves the client exactly one step behind, and every error names
 * the caller rather than the cause.
 *
 * Reproduced and confirmed: generating from the pre-16-October schema
 * reproduces all six errors at identical lines, columns and codes.
 *
 * ── Why it cannot be a guard inside the seed script
 *
 * Because the seed script does not COMPILE. ts-node type-checks it before a
 * line of it runs, so a check written at the top of the file can never
 * execute — the thing it would report is what stops it running. It has to be
 * a separate process that does not import the generated types at all.
 *
 * This reads the client's own DMMF, which is plain runtime JSON and is
 * present whatever state the types are in, and compares it to schema.prisma.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(root, 'backend/prisma/schema.prisma');

/**
 * A deliberately small parser: model and enum names, their field and value
 * names, nothing else. It does not need to understand types, attributes or
 * relations — a field the generated client has never heard of is the whole
 * question, and names are enough to ask it.
 */
function parseSchema(text) {
  const models = new Map();
  const enums = new Map();
  let current = null;
  let kind = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    const open = line.match(/^(model|enum)\s+([A-Za-z_]\w*)\s*\{/);
    if (open) {
      kind = open[1];
      current = open[2];
      (kind === 'model' ? models : enums).set(current, new Set());
      continue;
    }
    if (!current) continue;
    if (line === '}') {
      current = null;
      kind = null;
      continue;
    }
    // Block attributes (@@unique, @@map, @@index) are not fields.
    if (line.startsWith('@@')) continue;

    if (kind === 'model') {
      const field = line.match(/^([A-Za-z_]\w*)\s+\S/);
      if (field) models.get(current).add(field[1]);
    } else {
      const value = line.match(/^([A-Za-z_]\w*)\s*$/);
      if (value) enums.get(current).add(value[1]);
    }
  }
  return { models, enums };
}

let schemaText;
try {
  schemaText = readFileSync(schemaPath, 'utf8');
} catch {
  console.error(`❌ cannot read ${schemaPath}`);
  process.exit(1);
}

const { models, enums } = parseSchema(schemaText);

/**
 * A floor on the parse itself. A regex that silently matched nothing would
 * make every comparison below vacuously true and print a ✅ over an empty
 * set — which is the shape of defect this repository keeps finding, so the
 * parser gets the same treatment as the thing it checks.
 */
if (models.size < 10) {
  console.error(
    `❌ parsed only ${models.size} model(s) from schema.prisma. This checker is\n` +
      `   broken, not your client — a schema this small would not build.`,
  );
  process.exit(1);
}

const require = createRequire(join(root, 'backend/package.json'));
let dmmf;
try {
  ({ Prisma: { dmmf } } = require('@prisma/client'));
} catch (err) {
  console.error('❌ @prisma/client could not be loaded at all:\n');
  console.error(`   ${err.message.split('\n')[0]}\n`);
  console.error('   Run:  cd backend && npm install && npx prisma generate');
  process.exit(1);
}

if (!dmmf?.datamodel) {
  console.error('❌ the generated client exposes no datamodel.\n');
  console.error('   Run:  cd backend && npx prisma generate');
  process.exit(1);
}

const generatedModels = new Map(
  dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.map((f) => f.name))]),
);
const generatedEnums = new Map(
  dmmf.datamodel.enums.map((e) => [e.name, new Set(e.values.map((v) => v.name))]),
);

const missing = [];

for (const [model, fields] of models) {
  const generated = generatedModels.get(model);
  if (!generated) {
    missing.push(`model ${model} is in schema.prisma and not in the client`);
    continue;
  }
  for (const field of fields) {
    if (!generated.has(field)) missing.push(`${model}.${field}`);
  }
}

for (const [name, values] of enums) {
  const generated = generatedEnums.get(name);
  if (!generated) {
    missing.push(`enum ${name} is in schema.prisma and not in the client`);
    continue;
  }
  for (const value of values) {
    if (!generated.has(value)) missing.push(`${name}.${value}`);
  }
}

if (missing.length) {
  console.error('\n❌ The generated Prisma client is STALE.\n');
  console.error('   schema.prisma declares these, and the client does not:\n');
  for (const item of missing.slice(0, 20)) console.error(`     · ${item}`);
  if (missing.length > 20) console.error(`     … and ${missing.length - 20} more`);
  console.error(
    '\n   Every TypeScript error you are about to see — or just saw — will name\n' +
      '   the file that USES one of these, not this. Nothing is wrong with that\n' +
      '   file, your schema or your database.\n',
  );
  console.error('   Fix it with one command:\n');
  console.error('     cd backend && npx prisma generate\n');
  console.error(
    '   `prisma migrate deploy` does not regenerate the client, and postinstall\n' +
      '   only runs on install — so pulling and migrating leaves it one step\n' +
      '   behind. See docs/OUTSTANDING.md §76.\n',
  );
  process.exit(1);
}

console.log(
  `✅ generated Prisma client is current with schema.prisma ` +
    `(${models.size} models, ${enums.size} enums checked).`,
);
