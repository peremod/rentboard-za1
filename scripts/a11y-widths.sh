#!/usr/bin/env bash
# The accessibility sweep at the four widths CLAUDE.md makes a standing rule.
#
# ⚠️ a11y-drive ran at ONE width (412px) for its whole life, and the pass that
# added this found four defects it had never been able to see:
#
#   · the message composer overflowed its card at 360px — a flex child with
#     flex:1 and no min-width:0, invisible at 412;
#   · the board's five filter checkboxes were 20px-tall targets, stacked
#     6px apart, failing WCAG 2.2 AA 2.5.8 on the busiest page;
#   · every footer link was 17px tall, on all 33 pages, since the footer was
#     written;
#   · .portal-user-role was 3.72:1 against 4.5:1 — and ONLY at desktop
#     width, because below 900px the portal rail becomes a strip and the
#     element is not rendered at all.
#
# A gate that runs at a single viewport measures a single viewport. Run this,
# not the drive directly.
set -u
widths="360 390 768 1280"
fail=0
for w in $widths; do
  printf '\n════ %spx ════\n' "$w"
  if VIEWPORT_WIDTH="$w" node scripts/a11y-drive.mjs; then :; else fail=1; fi
done
echo
if [ "$fail" -ne 0 ]; then
  echo "❌ the sweep failed at one or more of: $widths"
  exit 1
fi
echo "✅ 360 / 390 / 768 / 1280 — all four widths clean."
