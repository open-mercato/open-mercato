# `.ai/ds/` — Design System machine artifacts

## `ds-tokens.json` — canonical token snapshot

Committed, reviewed like code. Generated from the single source of truth
(`apps/mercato/src/app/globals.css` — the three token blocks `@theme inline`,
`:root`, `.dark`) by `scripts/ds-tokens-export.mjs`. Regeneration from an
unchanged `globals.css` is byte-identical; keys are sorted; authored values are
stored verbatim (`light`/`dark`/`value`) and the derived sRGB `hex` pair is
display-only — drift always compares the authored value, never a lossy
conversion.

Any PR that edits a token in `globals.css` must also run `yarn ds:tokens` and
commit the snapshot diff. Token diffs require design-canon evidence in review
(a Figma link or spec reference).

```bash
yarn ds:tokens          # regenerate the snapshot
yarn ds:tokens:check    # diff live globals.css vs snapshot; exit 1 on drift
yarn ds:tokens:figma    # emit .ai/reports/ds-tokens-figma-ops.json
```

`ds-health-check.sh` reports the drift count as `Drifted tokens: N (target: 0)`.

## Figma Variables sync — one-way, code → Figma

Target: collection `OM Tokens` in the DS file `qCq9z6q1if0mpoRstV5OEA`, modes
`Light`/`Dark`. **Code pushes, Figma mirrors** — manual edits to the synced
collection are overwritten on the next push; canon changes land in
`globals.css` first, then flow outward. Two adapters:

1. **Plugin bridge (works on the current plan)** — `yarn ds:tokens:figma`
   writes a neutral upsert list (`{ collection, name, resolvedType,
   valuesByMode, codeSyntax }`) to `.ai/reports/ds-tokens-figma-ops.json`. Any
   agent session with Figma plugin tooling applies it via the
   `figma.variables` plugin API. The ops file is a regenerable working
   artifact, not a source of truth.
2. **REST (Enterprise-gated)** — `node scripts/ds-tokens-export.mjs
   --push-figma` uses the Figma Variables REST API, which requires an
   Enterprise plan and a personal access token with `file_variables:read` +
   `file_variables:write` scopes. The token is read from the `FIGMA_TOKEN`
   environment variable only — never commit it, never add it to `.env`
   defaults. Never run this in CI.

Snapshot-only tokens (`figma: null`): shadows and font stacks (Figma models
them as effect/text styles, not variables), plus any color whose value cannot
be resolved to RGBA in both modes (e.g. a `var()` reference).

## Related

- Code Connect mappings: `packages/ui/figma/*.figma.tsx`
  (`yarn ds:code-connect:check` parses tokenless; publish is
  Organization/Enterprise-gated, manual).
- Figma-side workflow skill: `.ai/skills/om-figma-design-with-ds/`.
- Spec: `.ai/specs/2026-07-05-ds-tokens-figma-sync-and-code-connect.md`.
