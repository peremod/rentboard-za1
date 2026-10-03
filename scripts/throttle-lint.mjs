/**
 * Every @Throttle must have a ThrottlerGuard that can actually run it.
 *
 * ── The bug this exists to prevent happening again
 *
 * Nineteen `@Throttle` decorators shipped doing nothing, across eight
 * controllers, for every release up to v1.85.1. Two independent reasons, and
 * the second hid the first:
 *
 *   1. ThrottlerGuard was never registered — not as an APP_GUARD, not on a
 *      controller, not on a route. A @Throttle with no guard in scope is a
 *      comment with syntax highlighting.
 *   2. The root throttler was named 'global' while every decorator keys
 *      'default'. A key matching no configured throttler is ignored, so even
 *      the fallback bucket did not apply.
 *
 * Neither is visible in review: the decorator is right there above the route,
 * saying five per fifteen minutes. It took sending eight requests to a route
 * marked `limit: 5` and getting eight 200s to see it.
 *
 * ── Why a script and not a grep
 *
 * This started as three lines of grep in verify-build.sh with a ±3-line window,
 * and immediately produced a false positive: phone/confirm-number carries its
 * guard eight lines above its @Throttle, with a paragraph of comment between
 * them. A rate-limit check that cries wolf is a rate-limit check somebody turns
 * off. So the decorator block is parsed properly: from the first decorator or
 * comment line above, to the handler signature below.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'backend/src');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** A decorator, a comment, or a continuation of either. */
const isBlockLine = (l) => /^\s*(@|\/\/|\*|\/\*|\})/.test(l) || /^\s*(default|limit|ttl|name)\s*:/.test(l);

const problems = [];

// 1. The root throttler's name has to be the key the decorators use.
const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
const rootName = appModule.match(/ThrottlerModule\.forRoot\(\[[\s\S]*?name:\s*'([^']+)'/);
const decoratorKeys = new Set();

for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('@Throttle(')) continue;
  const lines = text.split('\n');
  const classGuard = lines.some((l) => /^@UseGuards\([^)]*ThrottlerGuard/.test(l));

  lines.forEach((line, i) => {
    if (!/^\s*@Throttle\(/.test(line)) return;

    for (const key of line.matchAll(/(\w+)\s*:\s*\{/g)) decoratorKeys.add(key[1]);

    // Walk out to the edges of this route's decorator block.
    let top = i;
    while (top > 0 && isBlockLine(lines[top - 1])) top--;
    let bottom = i;
    while (bottom + 1 < lines.length && isBlockLine(lines[bottom + 1])) bottom++;

    const block = lines.slice(top, bottom + 1).join('\n');
    if (!classGuard && !/@UseGuards\([^)]*ThrottlerGuard/.test(block)) {
      problems.push(
        `${relative(ROOT, file)}:${i + 1} — @Throttle with no ThrottlerGuard in its decorator block.\n` +
        `       The limit does nothing. Add @UseGuards(ThrottlerGuard), or merge\n` +
        `       ThrottlerGuard into the route's existing @UseGuards(...).`,
      );
    }
  });
}

if (!rootName) {
  problems.push('backend/src/app.module.ts — ThrottlerModule.forRoot has no named throttler.');
} else {
  for (const key of decoratorKeys) {
    if (key !== rootName[1]) {
      problems.push(
        `backend/src/app.module.ts — the root throttler is named '${rootName[1]}' but a @Throttle keys '${key}'.\n` +
        `       A key matching no configured throttler is silently ignored, so that\n` +
        `       route's limit never applies. Make the names match.`,
      );
    }
  }
}

if (problems.length) {
  console.log(`❌ ${problems.length} rate-limit problem(s):`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
}
console.log(
  `✅ every @Throttle is guarded, and the root throttler is named '${rootName[1]}' — the key the decorators use`,
);
