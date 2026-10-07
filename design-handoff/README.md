# Mastande — design handoff

Four inventories of what this product **actually is today**, generated from the
code rather than from documentation, plus the tools that made them.

| Start here | |
|---|---|
| **`DESIGN-BRIEF.md`** | Positioning, who this is for, and the known UX problems — quoted from the repository's own records. **Read the box at the top first:** two documents named in the handoff request do not exist in this repository. |
| `ROUTE-INVENTORY.md` | 73 routes, every portal, with components and guards. |
| `TOKENS-CURRENT.md` | Every design value in use, counted. 33 tokens used 671 times; 158 literal colours bypassing them 330 times; 106 of those used exactly once. |
| `COMPONENT-INVENTORY.md` | 83 standalone components by portal, described in their own doc comments. |

## Regenerating

These are generated. Re-run rather than hand-editing — the whole point is that
the code is the source of truth:

```bash
node design-handoff/tools/routes.mjs      --md
node design-handoff/tools/tokens.mjs      --md
node design-handoff/tools/components.mjs  --md
```

Each also prints JSON with no flag, if you would rather pipe it somewhere.

## Running the app to see any of this

```bash
cd backend  && npm install && npm run start:dev    # :3000
cd frontend && npm install && npm start            # :4200
```

Needs PostgreSQL; `README.md` at the repo root has the full setup. For rendered
screens at real widths without doing that by hand, `scripts/mobile-drive.mjs`
and `scripts/layout-ui-drive.mjs` drive 360 / 390 / 768 / 1280px.

## What was NOT changed to produce this

No application code. This pass was inventory and packaging only: the four
documents, the three generators, and the zip. The generators read; they write
nothing.
