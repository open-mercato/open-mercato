# DS Tokens Figma Sync & Code Connect — anti-drift foundation between the DS Figma file and code

## TLDR

The design system lives in two places — `apps/mercato/src/app/globals.css` (shipped truth) and the DS Figma file `qCq9z6q1if0mpoRstV5OEA` (design truth) — with no machine link between them. Drift is real: on 2026-07-05 a design-canon reconciliation (`.ai/specs/2026-07-05-ds-system-guardian-refresh.md`, workstream 6) found `--brand-lime` shipped as `#D4F372` while Figma canon is `#B4F372`, and `--brand-violet` shipped as a themed OKLCH pair while canon is theme-invariant `#BC9AFF`. Both were caught by a human eyeballing swatches. This spec builds the tooling so the next drift is caught by a script, not a designer: (1) a token exporter that parses `globals.css` into a committed canonical JSON snapshot, feeds a drift check wired into `ds-health-check.sh`, and produces Figma Variables payloads (REST or plugin-bridge ops); (2) Code Connect mappings so inspecting a DS component in Figma yields the exact `@open-mercato/ui` import and props; (3) promotion of the `figma-design-with-ds` skill from local-only (`.git/info/exclude`) into the tracked `.ai/skills/` tree so the Figma-side workflow is versioned alongside the tokens it depends on.

## Overview

This is item 1 of the DS DX roadmap (branch `spec/ds-dx-developer-experience`), the follow-up to the DS System & Guardian Refresh spec. That spec fixed the drift and taught the guardian to flag the retired `#D4F372`; this one makes drift structurally detectable and gives designers/developers a bidirectional reference:

1. **Token export & sync** — `scripts/ds-tokens-export.mjs` + `yarn ds:tokens*` scripts + committed snapshot `.ai/ds/ds-tokens.json` + a drift line in `.ai/scripts/ds-health-check.sh`.
2. **Code Connect** — `packages/ui/figma/*.figma.tsx` mappings for the core primitive set, published to the DS file when plan/token allow, consumable locally by agent tooling either way.
3. **Skill promotion** — `figma-design-with-ds` becomes a tracked skill (`.ai/skills/om-figma-design-with-ds/`) registered in `tiers.json`, following the same canonical-source + symlink-install convention as `om-ds-guardian`.

Each workstream is independently reviewable and shippable. Nothing here changes runtime behavior.

## Problem Statement

Evidence gathered 2026-07-05:

- **Silent value drift between code and Figma.** `globals.css` defines ~140 OKLCH and ~60 hex custom-property values across three blocks (`@theme inline` at lines 41–172, `:root` at 174–292, `.dark` at 302–411). The Figma DS file defines the same palette as Figma variables, maintained by hand. Nobody diffs them. The brand-lime/brand-violet incident proves single values can be wrong for months; the fix itself now lives only as prose in a spec changelog, not as a checkable artifact.
- **No canonical machine-readable token list.** Every consumer that needs token values — the guardian skill's `references/token-mapping.md`, the `figma-design-with-ds` skill's `references/quick-tokens.md`, Figma briefs, future lint rules — re-transcribes `globals.css` by hand. Each transcription is a fresh drift vector (`quick-tokens.md` already carries the post-fix `#B4F372` while this branch's `globals.css` still ships `#D4F372` until the guardian-refresh branch merges — the two documents disagree *today*).
- **`ds-health-check.sh` cannot see token drift.** It counts hardcoded-color *usages* but has no notion of token *values*, so a wrong value in `globals.css` passes every existing check.
- **Figma → code handoff loses the import.** A designer or developer inspecting `Button` or `Alert` in the DS file sees Figma layer names, not `import { Button } from '@open-mercato/ui/primitives/button'` and the real prop surface. Agents building screens from Figma re-derive imports from `.ai/ui-components.md` (5,600+ lines) every time; humans guess.
- **The Figma workflow skill is invisible to the repo.** `figma-design-with-ds` (SKILL.md 252 lines + `references/audit-existing-design-prompt.md` + `references/quick-tokens.md`) physically sits in `.ai/skills/figma-design-with-ds/` but is suppressed by `.git/info/exclude` on one machine. It cannot be reviewed, synced, or kept consistent with token changes; other contributors do not know it exists.
- **Two `globals.css` copies must stay value-identical.** `packages/create-app/template/src/app/globals.css` mirrors the app copy except for `@source` node-module path depth. A guard already exists — `yarn template:sync` (`scripts/template-sync.ts`, `app/globals.css` transform at line 140 rewrites `../../../../node_modules/` → `../../node_modules/`) — verified value-identical on this branch. The token tooling must build on that guard, not duplicate it.

## Proposed Solution

### Workstream 1 — Token export, snapshot, and Figma sync

#### 1.1 Exporter script

New `scripts/ds-tokens-export.mjs` (Node, zero new dependencies — matches the `scripts/*.mjs` house style). It parses **only** `apps/mercato/src/app/globals.css` (single source of truth; the template copy is covered transitively by `template:sync`) and only the three token blocks:

- `@theme inline` — Tailwind theme mappings (`--color-* → var(--*)` aliases) plus directly-valued scale tokens: `--font-size-overline*`, `--z-index-*`, `--radius-*` (calc expressions), `--shadow-*`, `--font-sans/mono` references.
- `:root` — light-mode values (and theme-invariant tokens such as `--brand-apple`, `--focus-ring-*`, `--bg-disabled`).
- `.dark` — dark-mode overrides.

Everything after `@layer base` (resets, utility classes, MDX editor styles) is out of parser scope by design. The parser is line-oriented: `--name: value;` declarations, with the immediately preceding `/* … */` comment captured as `note`. A reformat of the file that keeps declarations one-per-line does not break it; the failure mode for anything unparseable is a hard error naming the line, never a silent skip.

Modes:

| Command | Behavior |
|---|---|
| `yarn ds:tokens` (`--write`) | Regenerate `.ai/ds/ds-tokens.json` from `globals.css`. Deterministic output (sorted keys, fixed 2-space indent, trailing newline) so re-runs are byte-stable. |
| `yarn ds:tokens:check` (`--check`) | Parse live `globals.css`, deep-compare against the committed snapshot, print a per-token diff (`token · field · snapshot → live`), exit 1 on any difference. `--count` prints only the number of drifted tokens (consumed by the health check). |
| `yarn ds:tokens:figma` (`--figma-ops`) | Emit `.ai/reports/ds-tokens-figma-ops.json` — a plan-agnostic upsert list for Figma Variables (see 1.3). Reports (`.ai/reports/`) are dated working artifacts; the ops file is regenerated on demand and not treated as a source of truth. |
| `--push-figma` | Push directly via the Figma REST Variables API (see 1.3 for the auth story). Optional; never run in CI. |

Color handling: OKLCH and hex are mixed in the source (142 `oklch(…)` values, 61 hex) and stay verbatim in the snapshot as the primary value. The exporter additionally derives a gamut-mapped sRGB hex per color (small self-contained OKLCH→linear-sRGB conversion, ~40 lines of math, no dependency) because Figma variables store RGBA. Both representations live in the snapshot so the drift check compares the authored value, not a lossy conversion.

#### 1.2 Canonical snapshot — `.ai/ds/ds-tokens.json`

Committed, reviewed like code. Any PR that edits a token in `globals.css` must also run `yarn ds:tokens`; the check turns an unnoticed one-line CSS edit into a visible structured diff in review (this is the mechanism that would have caught `#D4F372` at PR time). Schema in Data Models below.

New directory `.ai/ds/` (first file). Not placed in `.ai/reports/` because reports are dated, append-only health artifacts; the snapshot is a versioned contract with a stable path.

#### 1.3 Figma Variables sync — one-way, code → Figma

Direction of truth: **code pushes, Figma mirrors.** Manual edits to the synced collection in Figma are overwritten on the next push; canon changes made by design are landed in `globals.css` first (as the guardian-refresh workstream 6 did), then pushed.

Mapping (deterministic, implemented as a prefix table inside the exporter):

- One variable collection `OM Tokens` in file `qCq9z6q1if0mpoRstV5OEA` with modes `Light` and `Dark`.
- Themed tokens take their `:root`/`.dark` pair; theme-invariant tokens (all `brand-*`, `accent-indigo*`, disabled-control tokens, anything without a `.dark` override) carry the same value in both modes and `themeInvariant: true` in the snapshot. Note the current `--brand-violet` still has a `.dark` override on this branch; after the guardian-refresh branch lands it becomes invariant `#BC9AFF` and the snapshot records that automatically — the exporter derives invariance from the file, it does not hardcode a list.
- Variable names group by slash: `status/error/bg`, `chart/blue`, `brand/lime`, `z/modal-elevated`, `radius/md`. WEB code syntax is set to `var(--status-error-bg)` so Figma Dev Mode shows the exact CSS custom property.
- Types: colors → `COLOR`; z-index and resolved radius (px, using `--radius: 0.625rem` base for the calc expressions) → `FLOAT`. Shadows and font stacks are snapshot-only (Figma models them as effect/text styles, not variables) — explicitly out of push scope for this spec.

Two push adapters, because the auth story differs:

1. **REST adapter** (`--push-figma`): `GET /v1/files/{key}/variables/local` to resolve existing ids, then `POST /v1/files/{key}/variables` with an idempotent upsert-by-name payload. **Honest constraint: the Figma Variables REST API is Enterprise-plan-gated and needs a personal access token with `file_variables:read` + `file_variables:write` scopes.** The token is read from the `FIGMA_TOKEN` environment variable only — never committed, never in `.env` defaults; documented in the script header and `.ai/ds/README.md`. Without the plan/token the adapter fails fast with a message pointing at adapter 2. No CI job depends on it.
2. **Plugin-bridge ops file** (`--figma-ops`): emits the same upserts as neutral JSON (`{ collection, name, resolvedType, valuesByMode, codeSyntax }`). Any agent session with Figma plugin tooling connected applies them via the plugin `figma.variables` API, which is not Enterprise-gated. This is the adapter that works today with the tooling the team already uses against the DS file.

#### 1.4 Health-check integration

`.ai/scripts/ds-health-check.sh` gains one section, inserted before `=== END REPORT ===`, preserving the existing delta contract exactly (the delta diff greps `'^[+-]  '`, so the metric line keeps the two-space indent and the existing `label: value (target: N)` shape; all pre-existing lines stay byte-identical):

```bash
report "--- Token Snapshot Drift ---"
TD=$(node scripts/ds-tokens-export.mjs --check --count 2>/dev/null || echo "unavailable")
report "  Drifted tokens: $TD (target: 0)"
```

Old reports in `.ai/reports/` remain delta-comparable: the new section merely appears as an addition in the first run after this lands.

### Workstream 2 — Code Connect mappings

#### 2.1 What and where

Code Connect files (`@figma/code-connect`, devDependency) live centralized in `packages/ui/figma/*.figma.tsx` with `figma.config.json` at the `packages/ui` root. Centralized rather than colocated with each primitive so that (a) `packages/ui/src` build/test globs stay untouched — the `figma/` directory sits outside `src/` and never enters `dist` or the app bundle; (b) one directory answers "what is mapped" at a glance; (c) publish/parse runs from a single root.

Each mapping binds a DS Figma component (by node URL in file `qCq9z6q1if0mpoRstV5OEA`) to the real import and maps Figma variant properties to props with `figma.enum`/`figma.boolean`/`figma.string`, so Dev Mode inspection of a component instance renders a ready-to-paste snippet.

#### 2.2 Initial mapping set

Import paths verified against `.ai/ui-components.md` and `packages/ui/src/primitives/`:

| Figma component | Import | Key prop mappings |
|---|---|---|
| Button | `@open-mercato/ui/primitives/button` | `variant`, `size` |
| Input | `@open-mercato/ui/primitives/input` | type variants → dedicated components below |
| Email / Search / Password / Website input variants | `…/primitives/email-input`, `…/search-input`, `…/password-input`, `…/website-input` | size, disabled |
| Select | `@open-mercato/ui/primitives/select` (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`) | size, disabled |
| Checkbox | `…/primitives/checkbox` (+ `checkbox-field` for labeled variant) | checked, disabled |
| Radio | `…/primitives/radio` (`Radio`, `RadioGroup`; + `radio-field`) | checked, disabled |
| Switch | `…/primitives/switch` (+ `switch-field`) | checked, disabled |
| Alert (Figma node `169:2358`) | `…/primitives/alert` (`Alert`, `AlertTitle`, `AlertDescription`) | `status` (error/warning/success/information/feature), `style` (filled/light/lighter/stroke), `size` — the current API, never the deprecated `variant` |
| Tabs | `…/primitives/tabs` | `variant="underline"`, `count`, `leading` |
| Drawer (Figma node `486:7366`) | `…/primitives/drawer` (`Drawer`, `DrawerContent`, `DrawerHeader`, `DrawerTitle`, `DrawerDescription`, `DrawerBody`, `DrawerFooter`, `DrawerClose`) | footer `layout`, width 400 default |
| Badge | `…/primitives/badge` | variant |
| Tag | `…/primitives/tag` | `TagMap` color |
| StatusBadge | `…/primitives/status-badge` | `variant` (`success`/`warning`/`error`/`info`/`neutral`) |

Exact node URLs are resolved during implementation by inspecting the DS file (known anchors: Alert `169:2358`, Drawer `486:7366`, Table Row Cell `553:22175`, canonical table `167144:147544`) and recorded in the `.figma.tsx` files themselves — no separate registry to drift.

#### 2.3 Publishing and the plan gate

- `yarn ds:code-connect:check` → `figma connect parse` — validates every mapping compiles and props resolve; runs without any token, added to the same developer loop as `ds:tokens:check`.
- `yarn ds:code-connect:publish` → `figma connect publish` — **honest constraint: Code Connect publishing requires a Figma Organization or Enterprise plan and a token (env `FIGMA_TOKEN`, `code_connect:write` scope).** Run manually by a maintainer with access; never in CI.
- Without publish access the mappings still pay rent: agent tooling with a Figma bridge can load the local mapping set (the `.figma.tsx` files are plain data from its perspective) and attach code-connect maps at session time, so agent-driven Figma→code work gets correct imports today.

#### 2.4 Maintenance rule

Documented in `packages/ui/AGENTS.md` and the guardian skill: adding or renaming a primitive documented in `.ai/ui-components.md` requires touching its `packages/ui/figma/*.figma.tsx` mapping in the same PR (or adding one for new primitives in the initial set's families). `ds:code-connect:check` keeps mappings compiling against the real prop types, so prop renames fail loudly.

### Workstream 3 — Promote `figma-design-with-ds` into the tracked skill tree

Current state: the skill physically lives at `.ai/skills/figma-design-with-ds/` (SKILL.md + `references/audit-existing-design-prompt.md` + `references/quick-tokens.md`) but is suppressed via a local `.git/info/exclude` entry, alongside other machine-local skills. `.claude/skills` in this repo is a symlink to `.ai/skills`, and the sanctioned install path is per-skill symlinks created by `scripts/install-skills.sh` from `.ai/skills/tiers.json`.

Plan:

1. **Rename to `om-figma-design-with-ds`** — every tracked skill uses the `om-` prefix; the unprefixed names in `.git/info/exclude` are exactly the local-only set. Frontmatter `name:` updated to match.
2. **Track it**: `git add .ai/skills/om-figma-design-with-ds/` (tracking overrides the exclude; the maintainer additionally deletes the stale exclude line locally to avoid confusion).
3. **Register**: add to `tiers.json` under a new opt-in `design` tier (installed via `install-skills.sh --with design`), not `core` — the skill presumes Figma tooling most contributors don't run, and `core` is the default install set. Add the row to `.ai/skills/README.md`.
4. **Content reconciliation at promotion time**: `references/quick-tokens.md` is replaced from the same source as everything else — regenerated sections cite `.ai/ds/ds-tokens.json` as their source of truth and the hand-written prose keeps only usage guidance. Its brand values (`#B4F372`/`#BC9AFF`) already match post-guardian-refresh canon; the promotion PR asserts `yarn ds:tokens:check` passes so the skill can never be tracked in a state that contradicts the snapshot.
5. **Sync copy convention** (mirrors the guardian's): the canonical source is `.ai/skills/om-figma-design-with-ds/`; harness directories consume it via symlink (`install-skills.sh`). On checkouts where `.claude/skills` is a real directory instead of a symlink, the same-commit byte-identical rule applies, verified with `diff -rq .ai/skills/om-figma-design-with-ds .claude/skills/om-figma-design-with-ds`.

## Architecture

No runtime architecture changes. All additions are developer tooling and versioned agent assets:

```
globals.css (apps/mercato)  ──template-sync (existing guard)──▶  globals.css (create-app template)
        │
        ▼ parse (ds-tokens-export.mjs)
.ai/ds/ds-tokens.json  ◀── committed snapshot; --check diffs live vs snapshot
        │                        │
        │                        └──▶ ds-health-check.sh "Drifted tokens" line
        ▼ transform
Figma Variables (file qCq9z6q1if0mpoRstV5OEA)
   ├── REST adapter (Enterprise token, manual)
   └── plugin-bridge ops file (any plan, agent-applied)

packages/ui/figma/*.figma.tsx ──figma connect parse (tokenless check)──▶ publish (org/enterprise, manual)
```

The exporter is dependency-free Node; the only new package dependency anywhere is `@figma/code-connect` as a `packages/ui` devDependency (dev-only, never bundled). The snapshot flows one way out of `globals.css`; nothing ever writes CSS from JSON.

## Data Models

No database entities, migrations, or ORM changes. One versioned JSON artifact:

```jsonc
// .ai/ds/ds-tokens.json (excerpt)
{
  "source": "apps/mercato/src/app/globals.css",
  "tokens": {
    "brand-lime": {
      "kind": "color",
      "light": "#B4F372",           // authored value, verbatim
      "dark": null,                  // null ⇒ no .dark override
      "hex": { "light": "#b4f372", "dark": "#b4f372" },
      "themeInvariant": true,
      "figma": { "name": "brand/lime", "type": "COLOR" },
      "note": "Brand lime — theme-invariant (no .dark override)."
    },
    "status-error-bg": {
      "kind": "color",
      "light": "oklch(0.971 0.013 17.38)",
      "dark": "oklch(0.22 0.05 20)",
      "hex": { "light": "#fef2f2", "dark": "#3c1210" },
      "themeInvariant": false,
      "themeAlias": "color-status-error-bg",   // from @theme inline
      "figma": { "name": "status/error/bg", "type": "COLOR" }
    },
    "z-index-modal-elevated": { "kind": "number", "value": 55, "figma": { "name": "z/modal-elevated", "type": "FLOAT" } },
    "radius-md": { "kind": "expression", "value": "calc(var(--radius) - 2px)", "resolvedPx": 8 },
    "shadow-focus": { "kind": "shadow", "value": "0 0 0 2px var(--focus-ring-inner), 0 0 0 4px var(--focus-ring-outer)", "figma": null }
  }
}
```

Snapshot invariants: keys sorted; authored values verbatim (drift compares these, never derived hex); `figma: null` marks snapshot-only tokens; regeneration from an unchanged `globals.css` is byte-identical.

## API Contracts

No HTTP API, event, DI, ACL, or module contract surfaces change. Per `BACKWARD_COMPATIBILITY.md` categories: no types, signatures, import paths, event IDs, spot IDs, routes, DB schema, DI keys, ACL features, notification IDs, CLI commands, or generated files are touched. New root `package.json` scripts (`ds:tokens`, `ds:tokens:check`, `ds:tokens:figma`, `ds:code-connect:check`, `ds:code-connect:publish`) are additive, following the existing `i18n:*` / `template:*` naming pattern. `.ai/ds/ds-tokens.json` becomes a reviewed artifact but is not a runtime contract — no application code reads it.

## Migration & Backward Compatibility

- **No deprecations, no bridges.** Nothing existing is removed or renamed except the local-only skill directory (untracked → tracked under the `om-` name; no history to preserve since it was never committed).
- **Health report compatibility**: all existing metric lines stay byte-identical; the new section is additive and lands before `=== END REPORT ===`, so the delta comparison against pre-existing reports keeps working (first run shows the new lines as `+` additions, as with any new metric historically).
- **Template copy**: untouched here. `yarn template:sync` continues to own app↔template parity, including `globals.css` (with its `@source` path transform). The exporter deliberately reads only the app copy so there is exactly one parser input and one parity guard.
- **Ordering dependency**: this branch should land **after** `feat/ds-system-guardian-refresh`, so the initial committed snapshot encodes the corrected brand values (`#B4F372`, theme-invariant `#BC9AFF`). If ordering flips, the snapshot is regenerated in a trivial follow-up when the fix merges — the tooling is value-agnostic; only the initial frozen values differ.
- **Figma side**: the synced `OM Tokens` collection is created fresh; existing hand-made Figma variables are left in place and migrated/retired by the design owner at their own pace. No Figma component or library consumer breaks when the collection appears.

## Risks & Impact Review

| Risk | Concrete failure scenario | Severity | Mitigation | Residual |
|---|---|---|---|---|
| Parser brittleness | `globals.css` gets reformatted (multi-line declarations, nested blocks) and the exporter mis-parses, producing a wrong snapshot that then "legalizes" bad values | Medium | Line-oriented parser hard-errors on anything it cannot classify inside the three token blocks (no silent skips); unit tests cover each block shape plus a fixture of the full current file; `--check` failure output names exact tokens so a mass-diff is obviously a parser problem, not 140 real drifts | Low |
| OKLCH→hex conversion mismatch | Derived hex differs from what Figma renders (gamut clipping, rounding), designer "fixes" Figma, next push reverts it — churn loop | Medium | Authored OKLCH is the compared value; hex is display-only and documented as derived; conversion gamut-maps to sRGB with the same clamping the browser applies; push is one-way with a stated "Figma mirror is overwritten" contract | Low — worst case is a visually imperceptible rounding delta in the mirror |
| Enterprise gating makes the mirror stale | No one on the team holds an Enterprise REST token; pushes stop; Figma variables rot while code moves on | High (this is the failure mode the whole spec exists to prevent) | Primary adapter is the plugin-bridge ops file, which works on the current plan and current tooling; the drift *check* (code vs snapshot) is fully local and gates PRs regardless of any Figma access; staleness of the mirror is then bounded by "last time anyone ran the ops file", which the health report exposes via the ops file's mtime being regenerable on demand | Medium — Figma-side freshness still requires a human to apply pushes; accepted, since code-side truth is what CI can own |
| Snapshot churn noise | Every token PR now has a JSON diff; reviewers tune it out and rubber-stamp value changes | Low | The JSON diff is the *feature* (one token edit → one small structured hunk); deterministic output means zero incidental churn; guardian review checklist gains a "token diffs require design-canon evidence (Figma link or spec)" line | Low |
| Code Connect rot | A primitive's props change; the `.figma.tsx` still compiles against old node variants and shows a stale snippet in Dev Mode | Medium | `ds:code-connect:check` compiles mappings against real component types on every run (prop renames break the build of the check); maintenance rule ties `.ai/ui-components.md` edits to mapping edits; republish is a one-command manual step | Medium — Figma-side variant renames are not detectable locally; caught at next publish or audit |
| Skill promotion confusion | Other machines keep a stale `.git/info/exclude` line or a real (non-symlink) `.claude/skills` copy diverges from the tracked skill | Low | Tracked files override info/exclude semantics automatically; the `diff -rq` validation line (same convention the guardian refresh added) catches real-directory divergence; README/tiers registration makes the canonical path discoverable | Low |
| Wrong-direction edits | Designer edits the synced Figma collection directly; next push silently reverts design intent | Medium | Collection description in Figma states "synced from code — edit globals.css instead"; push adapters print a diff of what they are about to overwrite; canon changes flow code-first per the stated contract (as the brand-color fix already did) | Low–Medium — process rule, tooling can only warn |

## Validation Plan

```bash
# Workstream 1
yarn ds:tokens && git diff --exit-code .ai/ds/ds-tokens.json   # regeneration is byte-stable
yarn ds:tokens:check                                            # exit 0 on clean tree; mutate a token locally → exit 1 naming it
yarn test scripts/__tests__/ds-tokens-export.test.mjs           # parser fixtures: three blocks, oklch/hex/calc/var(), invariance detection
bash .ai/scripts/ds-health-check.sh                             # report contains "Drifted tokens: 0 (target: 0)"; prior metric lines unchanged
yarn template:sync                                              # existing guard still green (globals.css parity untouched)
yarn ds:tokens:figma && node -e "JSON.parse(require('fs').readFileSync('.ai/reports/ds-tokens-figma-ops.json'))"

# Workstream 2
yarn ds:code-connect:check                                      # figma connect parse passes tokenless
yarn build:packages                                             # packages/ui/figma/ stays out of dist

# Workstream 3
bash scripts/validate-skills-tiers.sh                           # tiers.json still valid with the design tier
bash scripts/install-skills.sh --with design                    # symlink created; skill loads
yarn ds:tokens:check                                            # promotion PR gate: quick-tokens.md claims match snapshot values
```

Integration coverage: not applicable — no API or UI runtime paths change; the exporter unit tests and the tokenless Code Connect parse are the executable coverage for all code added. Manual verification for the Figma-side effects (variables appear with correct modes/values; Dev Mode shows the Button/Alert snippets) is performed once against file `qCq9z6q1if0mpoRstV5OEA` and evidenced with screenshots in the implementation PR.

## Final Compliance Report

- No cross-tenant or data-security surface touched; no application runtime code changes at all.
- No hardcoded user-facing strings introduced — all new output is developer-facing tooling text.
- No contract surface modified; deprecation protocol not triggered; no `yarn generate` needed (no module auto-discovery files added).
- Secrets policy honored: `FIGMA_TOKEN` is environment-only, plan gating is documented rather than worked around, and no token, file export, or Figma payload containing credentials is ever committed.
- Design System rules honored by construction: the tooling consumes semantic tokens from their single source of truth and adds enforcement; it introduces no colors, styles, or components of its own.

## Changelog

- 2026-07-05 — Spec created as item 1 of the DS DX roadmap (follow-up to `2026-07-05-ds-system-guardian-refresh.md`): token exporter + committed snapshot + health-check drift line, Figma Variables sync with dual adapters (Enterprise REST / plugin-bridge ops), Code Connect mapping set for the core primitives, and promotion of `figma-design-with-ds` to the tracked `om-figma-design-with-ds` skill under a new opt-in `design` tier.
- 2026-07-18 — All three workstreams implemented. WS1: `scripts/ds-tokens-export.mjs` (+ 17 `node:test` cases in `scripts/__tests__/`), snapshot `.ai/ds/ds-tokens.json` (111 tokens) with `.ai/ds/README.md`, `yarn ds:tokens*` scripts, health-check `Token Snapshot Drift` section. WS2: 18 Code Connect mappings across 12 `packages/ui/figma/*.figma.tsx` files + `figma.config.json`; `ds:code-connect:check` parses clean and Dev Mode imports resolve to `@open-mercato/ui/primitives/*`. Deviation from 2.2: only the known node anchors (Alert `169-2358`, Drawer `486-7366`) are recorded — the remaining families carry an explicit `TODO(figma)` placeholder node id to resolve in one Figma session before the first `ds:code-connect:publish` (Figma access was unavailable during implementation; `check` and publish gating are unaffected). WS3: skill tracked as `.ai/skills/om-figma-design-with-ds/` in the new opt-in `design` tier, `quick-tokens.md` cites the snapshot as source of truth, promotion gated on a passing `ds:tokens:check`.
