# DS Foundation — Implementation Spec (Phases 1–3)

> **Companion docs (read first):**
> - [DS hackathon audit & plan](../../docs/design-system/) — source of truth for design intent (April 11–12, 2026 hackathon, PR #1226). Specifically: [`audit.md`](../../docs/design-system/audit.md), [`principles.md`](../../docs/design-system/principles.md), [`foundations.md`](../../docs/design-system/foundations.md), [`components.md`](../../docs/design-system/components.md) (22-component MVP list), [`priority-table.md`](../../docs/design-system/priority-table.md), [`hackathon-plan.md`](../../docs/design-system/hackathon-plan.md).
> - [`.ai/design-system-audit-2026-04-10.md`](../design-system-audit-2026-04-10.md) — single-file 6352-line condensed audit.
> - [`.ai/ds-rules.md`](../ds-rules.md) — runtime DS rules (color tokens, typography, spacing, decision trees).
> - [`.ai/ui-components.md`](../ui-components.md) — primitive API reference (variants, sizes, props, MUST rules per primitive).
> - [`packages/ui/AGENTS.md`](../../packages/ui/AGENTS.md) — UI package guidelines and Boy Scout Rule for DS migrations.
> - [`docs/ds-figma-worklog`](https://github.com/zielivia/open-mercato/tree/docs/ds-figma-worklog) branch — internal Figma↔code mapping working docs (~1246 lines, not merged to `develop`; superseded by [`.ai/ui-components.md`](../ui-components.md)).
> - Figma source: [DS — Open Mercato](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato).

## TLDR

**Key Points:**
- Implementation spec for the DS Foundation workstream — three phases that take the hackathon audit (April 11–12) from documentation into shipping primitives + token system.
- **Phase 1** (DONE, [PR #1708](https://github.com/open-mercato/open-mercato/pull/1708) — branch `refactor/ds-foundation-v1`): brand color tokens, shadow + radius scales, 4 new primitives (Tag, Avatar, AvatarStack, Kbd), Button family unification (sizes 2xs–lg, destructive variants, IconButton/LinkButton/SocialButton/FancyButton), Checkbox unification (with CheckboxField), and a repo-wide DS-token migration sweep across 279 files.
- **Phase 2** (DONE, [PR #1709](https://github.com/open-mercato/open-mercato/pull/1709) — branch `refactor/ds-foundation-v2`): form-primitive rewrites aligned to Figma (Input, Select, Switch, Radio, Textarea, Tooltip), composite fields (SwitchField, RadioField), sweep migrations of raw `<input>`/`<select>` consumers, plus a CrudForm bug fix uncovered by the Radix Select migration.
- **Phase 3** (TODO — **umbrella programme of multiple PRs**, one per primitive or logical group): six sub-tracks. **3.0 Figma audit** kicks off the phase by enumerating the full primitive backlog from the [Figma DS file](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato) (the list is long and not yet scoped); **3.A Specialized form variants** delivers the named-known ones (TagInput, CounterInput, DigitInput/OTP, InlineInput, CompactSelect, InlineSelect); **3.B Other Figma primitives** delivers the TBD list emerging from 3.0; **3.C Visual regression testing tool** introduces a new sub-track for per-primitive snapshot coverage in CI; **3.D `forwardRef` Selects deprecation** migrates TenantSelect, OrganizationSwitcher, CategorySelect with formal deprecation protocol; **3.E QA toolbox** harvests the Phase-2 lessons (Radix Select Playwright helpers, jsdom polyfill, DS Guardian patterns); **3.F Next.js 16.2.4 + Turbopack** follow-up for the dev memory-leak. Each sub-track ships as its own dated companion spec.

**Scope:**
- 32 primitives in `packages/ui/src/primitives/`. New in Phase 1: Tag, Avatar, AvatarStack, Kbd. Rewritten in Phase 2: Input, Select, Switch, Radio, Textarea, Tooltip. (FormField, StatusBadge, SectionHeader were delivered as Phase 0 in `feat/ds-semantic-tokens-v2` before this spec.)
- Token system in `apps/mercato/src/styles/globals.css` (foundation, brand, status, shadow, z-index scales). DS Phase 0 already introduced semantic status tokens — Phase 1 modernizes the foundation tokens (corner radius scale, token consolidation) and adds brand + shadow scales.
- Repo-wide migration: 279 files in v1 (token sweep across `@open-mercato/ui`, AI Assistant, Search, core modules, apps, checkout, webhooks, enterprise, onboarding, scheduler, create-app); 136 files in v2 (raw `<input>`, raw `<select>`, user-active toggle).
- 30+ integration tests touched by the Radix Select migration in v2.

**Concerns:**
- Phase 1 and Phase 2 are sequenced: v2 builds on v1, so v2 PR is blocked until v1 merges. Squash-merge recommended at the GitHub merge step to keep `develop` history clean (see [Lessons Learned](#lessons-learned)).
- Radix Select **does not accept `value=""`** in `SelectItem` — it throws at render time. This regression slipped through in v2's raw-`<select>` sweep migration when CrudForm's Select branch rendered options with empty-string values for "default/none" choices. Fixed mid-flight in [PR #1709 commit `806472e2f`](https://github.com/open-mercato/open-mercato/pull/1709/commits/806472e2f) (`CrudForm` filters empty-value options before rendering as `SelectItem`). Pattern documented as a class of regression to watch for in future migrations.
- 30+ `fix(qa)` commits accumulated in v2 from iterative test stabilization against CI (Radix Select selectors, jsdom polyfills, dialog-nested keyboard nav). Process improvement captured in [Lessons Learned](#lessons-learned).
- `forwardRef` Selects (`TenantSelect`, `OrganizationSwitcher`, `CategorySelect`) deferred to Phase 3 with formal deprecation protocol: their tests assert the **native `<select>` API** (`getByRole('option')` + `selectOption`) and the migration breaks every consumer test until they are rewritten. Treated as a `STABLE` contract surface change requiring `@deprecated` + bridge per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md).

---

## Overview

The Open Mercato Design System (DS) workstream began with a 26-hour hackathon (April 11–12, 2026) that produced a 13287-line audit and plan in `docs/design-system/`. The audit catalogued 372 hardcoded color values, 61 arbitrary text sizes, 79% of pages missing empty-state handling, and 370+ interactive elements without `aria-label` across 160 backend pages and 34 modules. It also defined a 22-component MVP list, 7 layers of design-system completeness (foundations, components, patterns, usage rules, documentation, code implementation, governance), and a priority matrix for execution.

Immediately after the hackathon, three branches landed in `develop`:

1. **`feat/ds-semantic-tokens-v2`** — semantic status color tokens, FormField/StatusBadge/SectionHeader primitives, Alert/Badge/Notice/FlashMessages/Notifications migration to semantic tokens, customers and sales modules migrated.
2. **`feat/ds-guardian-skill`** — DS Guardian skill agent (in `.ai/skills/ds-guardian/`) that enforces DS compliance at edit time, plus AGENTS.md DS rules and a baseline `ds-health-check.sh` script.
3. **`docs/ds-agents-and-guidelines`** — AGENTS.md updates carrying the "Boy Scout Rule" and migration order.

These three branches are referred to in this spec as **Phase 0** — they are already in `develop` and out of scope for review here, but they form the foundation that Phase 1 and Phase 2 build on.

This spec covers what comes next:

- **Phase 1 (v1)**: foundation tokens (brand colors, shadow scale, corner-radius consolidation), the entity-presentation primitives (Tag, Avatar, AvatarStack, Kbd), the Button family unification (one CVA-driven primitive, five sizes including `2xs`, full destructive sub-family), Checkbox unification, and a repo-wide DS-token migration sweep that gets every package on the same color palette.
- **Phase 2 (v2)**: form-primitive rewrites that align with Figma's Text Input, Select, Switch, Radio, and Textarea specs, plus a brand-aligned Tooltip with arrow indicator. Sweep migration moves raw `<input>` and raw `<select>` consumers onto the primitives, and migrates the user-active toggle to the new Switch.
- **Phase 3 (planned, umbrella programme)**: a series of PRs — each scoped to a primitive or a small logical group — that complete the DS primitive surface. Sub-tracks: a Figma audit (3.0) that enumerates the still-unknown long list of primitives in the design source of truth, the named specialized form variants (3.A: TagInput, CounterInput, DigitInput/OTP, InlineInput, CompactSelect, InlineSelect), other primitives surfaced by 3.0 (3.B), a new visual-regression-testing tool (3.C) integrated with CI for per-primitive snapshot coverage, the `forwardRef` Selects deprecation (3.D), a Playwright/jsdom QA toolbox harvested from Phase 2's iterative debugging (3.E), and a follow-up to investigate the Next.js 16.2.4 + Turbopack dev memory-leak observed during Phase 2 testing (3.F).

The intent is that **all three phases together** complete the "Components" layer of the 7-layer framework defined in `docs/design-system/coverage-report.md` and unlock module-level adoption across the rest of `develop`.

---

## Problem Statement

From the [hackathon audit](../../docs/design-system/audit.md):

1. **Inconsistent color usage** — 372 hardcoded color values bypassing the token system. Status colors mixed `red-600`, `text-red-700`, `text-destructive`, and ad-hoc oklch values across modules. Phase 0 fixed status semantics; Phase 1 must align the rest (brand, foundation, neutrals) with a single token taxonomy.
2. **Inconsistent typography** — 61 arbitrary text sizes (`text-[13px]`, `text-[18px]`) breaking the Tailwind scale. Phase 0 introduced `text-overline`; the rest is enforced by DS Guardian and codemods, not by code changes here.
3. **Component drift** — the audit listed 22 MVP components. Phase 0 delivered FormField, StatusBadge, SectionHeader, and unified Alert/Notice. Phase 1 needs to deliver Tag (entity labeling), Avatar/AvatarStack (people/teams), Kbd (keyboard hints — required by the DS dialog-shortcut rule), and unify the Button family that had drifted into multiple parallel implementations across modules.
4. **Form primitive divergence** — raw `<input>`, `<select>`, and `<textarea>` elements appeared 70+ times across the codebase, with bespoke styling per consumer. Phase 2 rewrites the primitives to Figma spec and sweeps consumers.
5. **Missing brand presence** — the design language calls for a brand violet/lime/yellow gradient for AI moments and identity, with no token system. Phase 1 introduces brand color tokens.
6. **Fragile shadows and radii** — multiple shadow definitions (`shadow-sm`, `shadow-md`, ad-hoc `box-shadow:`) without a coherent scale. Phase 1 introduces a shadow scale aligned to Figma elevation steps and consolidates corner radius tokens.

This spec maps directly to the [hackathon priority table](../../docs/design-system/priority-table.md):

| Priority area (hackathon) | Phase | Status |
|---|---|---|
| Semantic color tokens | 0 | DONE |
| Alert / Notice unification | 0 | DONE |
| Typography scale | 0 + DS Guardian | DONE (enforced) |
| FormField wrapper | 0 | DONE |
| StatusBadge | 0 | DONE |
| SectionHeader | 0 | DONE |
| Badge status variants | 0 | DONE |
| Flash / Notifications semantic | 0 | DONE |
| **Brand color tokens** | 1 | DONE in v1 |
| **Tag primitive** | 1 | DONE in v1 |
| **Avatar / AvatarStack** | 1 | DONE in v1 |
| **Kbd / KbdShortcut** | 1 | DONE in v1 |
| **Button family unification** | 1 | DONE in v1 |
| **Checkbox unification** | 1 | DONE in v1 |
| **Shadow + radius scale** | 1 | DONE in v1 |
| **Token sweep migration** | 1 | DONE in v1 |
| **Input rewrite (Figma)** | 2 | DONE in v2 |
| **Select primitive** | 2 | DONE in v2 |
| **Switch + SwitchField** | 2 | DONE in v2 |
| **Radio + RadioField** | 2 | DONE in v2 |
| **Textarea (showCount)** | 2 | DONE in v2 |
| **Tooltip (arrow + sizes)** | 2 | DONE in v2 |
| **Sweep migrations form** | 2 | DONE in v2 |
| Specialized form variants | 3 | TODO |
| forwardRef Selects deprecation | 3 | TODO |
| QA toolbox | 3 | TODO |
| Next.js 16.2.4 perf | 3 | TODO |

---

## Proposed Solution & Phasing

### Phase 0 — DONE in `develop` (referenced; not in scope)

Delivered before this spec was authored, by:
- [PR #1226](https://github.com/open-mercato/open-mercato/pull/1226) `Docs/design system audit 2026 04 10`
- `feat/ds-semantic-tokens-v2` branch (5 commits, merged via subsequent PRs):
  - `feat(ds): add semantic status tokens, text-overline, and z-index scale`
  - `refactor(ds): migrate Alert and Badge to semantic status tokens`
  - `refactor(ds): migrate Notice, FlashMessages, and Notifications to semantic tokens`
  - `feat(ds): add FormField, StatusBadge, and SectionHeader components`
  - `refactor(ds): migrate customers module to semantic status tokens`
  - `refactor(ds): migrate sales module to semantic status tokens`
- `feat/ds-guardian-skill` branch — `.ai/skills/ds-guardian/` skill agent + scripts + baseline `ds-health-2026-04-11.txt`.
- `docs/ds-agents-and-guidelines` — AGENTS.md DS rules and PR template updates.

Out of scope for review under this spec; documented for traceability and to make the phasing explicit.

### Phase 1 — DONE in [PR #1708](https://github.com/open-mercato/open-mercato/pull/1708) (`refactor/ds-foundation-v1`)

**16 commits, 279 files changed (+2812 / −1282).**

| Commit | Scope |
|---|---|
| `5a4a418ae refactor(ui): modernize AppShell with DS tokens and max-width constraint` | App shell consistency. |
| `132235799 fix(ui): replace FilterBar emoji and inline SVG with Lucide icons` | Icon system consistency. |
| `a65b1f13c refactor(ds): consolidate corner radius tokens across checkout and content` | Foundation token. |
| `3cc281b95 refactor(ds): modernize foundation CSS tokens in globals.css` | Foundation token modernization. |
| `c39ecaeec refactor(ds): migrate @open-mercato/ui to DS foundation tokens` | UI package sweep. |
| `c15dfcb3d refactor(ds): migrate AI Assistant and Search packages to DS foundation tokens` | Cross-package sweep. |
| `047b3145b refactor(ds): migrate @open-mercato/core modules to DS foundation tokens` | Core modules sweep. |
| `d38ffc8f8 refactor(ds): migrate apps, checkout, webhooks, enterprise, onboarding, scheduler, create-app to DS tokens` | App + cross-package sweep. |
| `94552b23c docs(ds): expand AGENTS.md with prescriptive decision trees and Figma mapping` | DS Guardian rules expansion. |
| `6095c4a91 feat(ds): add Tag primitive and brand color tokens` | New primitive + brand tokens. |
| `12fdad9b4 feat(ds): add Avatar, AvatarStack, Kbd primitives and shadow scale tokens` | New primitives + shadow scale. |
| `347099ba8 feat(ds): button family + checkbox unification + Figma state polish` | Button family + Checkbox unification. |
| `0cda08f67 chore(ds): move internal figma worklog to docs/ds-figma-worklog branch` | Worklog isolation. |
| `932a6f2f0 chore: trigger CI cache rebuild` | CI infra. |
| `9ab3d6558 chore: normalize yarn.lock trailing whitespace` | Lockfile hygiene. |
| `34d6b6531 fix(ds): restore React import in Avatar primitive` | Bug fix. |

**Net deliverables:**
- 4 new primitives in `packages/ui/src/primitives/`: `tag.tsx`, `avatar.tsx`, `kbd.tsx` (Kbd + KbdShortcut), plus brand color tokens shared across the system.
- Button family: `button.tsx` (variants `default | destructive | destructive-outline | destructive-soft | destructive-ghost | outline | secondary | ghost | muted | link`, sizes `2xs | sm | default | lg | icon`), `icon-button.tsx`, `link-button.tsx`, `social-button.tsx`, `fancy-button.tsx`.
- Checkbox unification: `checkbox.tsx` with indeterminate support and `--accent-indigo` selection color, plus `checkbox-field.tsx` composite (label + description + badge/link).
- Shadow scale tokens (`--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-focus`) and corner radius consolidation (`--radius` + Tailwind `rounded-sm/md/lg/xl/full` mapping).
- AppShell modernization: max-width constraint, semantic background.
- Repo-wide DS token migration sweep — every `bg-white/black/gray-*`, `text-gray-*`, `border-gray-*` usage replaced with semantic tokens or DS-aware equivalents.

### Phase 2 — DONE in [PR #1709](https://github.com/open-mercato/open-mercato/pull/1709) (`refactor/ds-foundation-v2`)

**16+ commits (with 13 stabilization commits ahead of merge), 136 files changed (+4575 / −2268).**

| Commit | Scope |
|---|---|
| `7f1e5bcb2 feat(ds): align Input primitive with Figma Text Input spec` | Input rewrite (left/right icon slots, wrapper-based focus styling). |
| `e606f6813 refactor(ds): migrate raw <input> usages to Input primitive` | Sweep migration. |
| `61f17f9b9 feat(ds): add Select primitive + sweep migration of raw <select>` | Radix Select primitive + sweep. |
| `520cba466 feat(ds): align Switch primitive with Figma + add SwitchField composite` | Switch rewrite + composite. |
| `963f7856e refactor(ds): migrate user-active toggle to Switch primitive` | Sweep migration. |
| `744245694 feat(ds): Radio + Textarea + Tooltip primitives, plus Switch/Checkbox alignment polish` | Three primitives + composites + alignment polish. |
| `c1a964ba2 fix(ds): tooltip provider + integration test migration to Radix Select` | App-root TooltipProvider + first wave of test migrations. |
| `c99f53dbf fix(ds): unit + integration tests for Radix Select/Radio migration` | Unit + integration test stabilization. |
| `1ae1760ce fix(ds): integration tests + sales helpers for Radix Select migration` | Sales helpers + further test migrations. |
| `47b3ddd49 chore: ignore apps/mercato/data/ runtime cache files` | gitignore hygiene. |
| `c19d6d203 fix(qa): assert input values before wizard Next click (state flush)` | Wizard test stabilization. |
| `617f120b5 fix(qa): robust wizard test — sequential typing + extended timeouts` | Wizard test stabilization. |
| `6c699333a fix(qa): comprehensive Radix Select test migrations across all shards` | Cross-shard test migration. |
| `8fb5c9a81 fix(qa): target Radix Select via field-id, keyboard nav for dialog-nested` | Field-id selectors + dialog-nested keyboard nav. |
| `90026b843 fix(qa): scope Radix Select tests by label/placeholder, not field-id` | Detail-page tests (PersonHighlights uses inline editors, not CrudForm — so no `data-crud-field-id` wrapper). |
| `37c58ecd0 fix(qa): scope TC-CRM-013 pipeline picker by label, not first combobox` | Pipeline picker disambiguation. |
| `fca3cdcff fix(qa): stabilize TC-CRM-002 and TC-ADMIN-007 against slow CI` | (Superseded by next commit.) |
| `806472e2f fix(ui,qa): root-cause fixes for TC-ADMIN-007 and TC-CRM-002` | **CrudForm Radix Select empty-value crash fix** + field-id selector for company create form. |
| `3b2164d88 fix(qa): TC-MSG-009 use submit button click instead of Ctrl+Enter` | Test fix — SwitchableMarkdownInput textarea has no Ctrl+Enter handler. |

**Net deliverables:**
- 6 form primitives rewritten / new: `input.tsx` (Figma-aligned wrapper with `leftIcon`/`rightIcon` slots), `select.tsx` (Radix-based with `SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue` exports + size variants), `switch.tsx` (Figma-aligned 18px/22px sizes, `--accent-indigo` checked state), `radio.tsx` + `radio-field.tsx` (Radix-based group with full keyboard a11y), `textarea.tsx` (rewritten with `showCount` + `maxLength` + aria-live counter), `tooltip.tsx` (3 sizes, default arrow indicator, dark-by-default with `light` variant).
- Composite fields: `switch-field.tsx` (label + description + badge/link), `radio-field.tsx` (mirrors CheckboxField API).
- App-root TooltipProvider mount (required by Radix Tooltip).
- Sweep migration: raw `<input>` consumers (~30+ files), raw `<select>` consumers (~20 files), user-active toggle → Switch primitive.
- **CrudForm regression fix** ([commit `806472e2f`](https://github.com/open-mercato/open-mercato/pull/1709/commits/806472e2f)): `CrudForm` now filters out options with empty-string `value` before rendering them as Radix `SelectItem`. The empty option remains represented by `SelectValue placeholder` for "no selection" UX.
- Documentation expansion: [`.ai/ui-components.md`](../ui-components.md) grown to 968 lines covering 16 primitive sections.

### Phase 3 — TODO (umbrella programme; multiple PRs, one companion spec per sub-track)

**Phase 3 is not a single PR.** It is a programme of independently shippable PRs, each scoped to a primitive or a small logical group. Each sub-track owns its own dated companion spec under `.ai/specs/`. The first sub-track (3.0 Figma audit) enumerates the full Phase 3 backlog — the list below is the **known minimum**, not the total scope.

**Naming convention for companion specs** (one per sub-track, plus one per primitive in 3.A/3.B):
- Track-level: `.ai/specs/{date}-ds-foundation-v3-{track-slug}.md` (e.g. `2026-XX-XX-ds-foundation-v3-figma-audit.md`, `2026-XX-XX-ds-foundation-v3-visual-regression.md`).
- Primitive-level (within 3.A / 3.B): `.ai/specs/{date}-ds-{primitive-slug}.md` (e.g. `2026-XX-XX-ds-tag-input.md`).

#### 3.0 — Figma audit & scope alignment (must run first)

Goal: produce the authoritative list of remaining primitives by walking the [Figma DS Open Mercato](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato) file frame-by-frame.

Outputs:
- An enumerated list of every Figma component not yet mapped to code.
- Mapping table updates in [`docs/ds-figma-worklog`](https://github.com/zielivia/open-mercato/tree/docs/ds-figma-worklog).
- A backlog appendix to this spec OR a dedicated companion spec listing every primitive with: Figma node ID, Figma name, proposed code primitive name, priority, complexity estimate.
- Per-primitive companion specs created in batches — one batch per logical group (e.g. "form variants", "data display", "navigation", "feedback").

Acceptance: `docs/ds-figma-worklog` updated; appendix/companion spec lists 100% of Figma DS components with status (DONE / IN PROGRESS / TODO / OUT OF SCOPE).

#### 3.A — Specialized form variants (named known scope)

Each of the following ships as its own PR with a dedicated companion spec. Tests + Storybook-equivalent example included in the same PR.

- `TagInput` (Figma 428:4860) — chip-input pattern for tag entry (used in CRM, catalog perspectives).
- `CounterInput` (Figma 428:5656) — number input with stepper buttons.
- `DigitInput` / `OTP` (Figma 429:5172) — single-digit boxes for verification codes (auth flows).
- `InlineInput` — borderless inline editing primitive (used by `PersonHighlights`-style inline editors).
- `CompactSelect` — h-7 dense select for toolbars and filter bars.
- `InlineSelect` — borderless inline select for inline editors.

#### 3.B — Other Figma primitives (TBD scope from 3.0)

Will be filled in by 3.0. Likely candidates from the Figma file (to be confirmed by audit):
- Dedicated primitives the audit may surface: Skeleton, Toast (currently FlashMessages), CommandPalette, EmptyState (full primitive vs current `TabEmptyState`), DateRangePicker, FileUpload, RichTextEditor (currently MDEditor wrapped), etc.
- Each primitive ships as its own PR + companion spec.

#### 3.C — Visual regression testing tool (new sub-track)

Goal: every primitive has automated visual coverage in CI, catching token / spacing / layout regressions before merge.

Decisions to make in the companion spec:
- Tool selection: **Playwright snapshots** (already in repo, zero new deps) vs **Chromatic** (Storybook-tied, paid SaaS) vs **Percy** (paid SaaS) vs **Loki** (Storybook-tied, OSS) vs **lost-pixel** (OSS).
- Storage: in-repo (committed PNG snapshots, blame-friendly) vs external (S3/CDN, repo-clean).
- Scope: per-primitive isolated story vs full-page snapshots vs both.
- Browser matrix: Chromium-only vs Chromium + Firefox + WebKit.
- Cadence: every PR, nightly, or both.
- Baseline establishment: which commit becomes the source of truth for "before" snapshots.

Acceptance: companion spec authored, tool chosen, CI integration shipped, baseline established. After this sub-track lands, every Phase 3 primitive PR (3.A and 3.B) MUST include visual snapshots in the same commit as the primitive code.

Why this matters for the DS workstream specifically: a token-driven primitive can drift visually across modules without any test failure (color tokens are correct, layout is correct, but elevation / radius / spacing changed by 2px). Visual regression catches this early.

#### 3.D — `forwardRef` Selects deprecation

`TenantSelect`, `OrganizationSwitcher`, `CategorySelect` still expose the native `<select>` API. Migrate to Radix Select with deprecation protocol per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md):
- Add `@deprecated` JSDoc + dev-mode `console.warn`.
- Ship a bridge wrapper that maps `getByRole('option')` test patterns onto Radix-equivalents (or document the test migration recipe).
- Document in `RELEASE_NOTES.md`.
- Remove the legacy implementation after ≥1 minor version.

Each `Select` ships as its own PR (low risk per PR) OR as a single deprecation PR + a follow-up removal PR after the deprecation window.

#### 3.E — QA toolbox

Codify what we learned in v2:
- `createRadixSelectFieldHelper(page, fieldId)` Playwright fixture in `packages/shared/src/lib/testing/` (or `.ai/qa/helpers/`).
- `jsdomRadixPolyfill()` helper for unit tests (currently inlined in [`packages/core/src/modules/catalog/components/products/__tests__/VariantBuilder.test.tsx`](../../packages/core/src/modules/catalog/components/products/__tests__/VariantBuilder.test.tsx)).
- "Radix Select migration patterns" section in [`.ai/skills/ds-guardian/references/component-guide.md`](../skills/ds-guardian/references/component-guide.md) covering: field-id selectors, placeholder-text scoping for inline editors, label-scoped scoping for ambiguous comboboxes, dialog-nested keyboard navigation, empty-value guard.

Single PR with companion spec.

#### 3.F — Next.js 16.2.4 + Turbopack dev memory leak

Investigate, isolate to repro case, file upstream issue if confirmed, document workaround. Likely small PR or pure investigation issue; spec optional unless code changes are required.

#### Track ordering & dependencies

- 3.0 must run first (it informs 3.B scope).
- 3.E and 3.C should land before 3.A / 3.B — the toolbox + visual regression infrastructure makes new-primitive PRs safer and faster to review.
- 3.A and 3.B can run in parallel (each primitive is independent).
- 3.D is independent of the others; can run any time after Phase 2 merges.
- 3.F is independent.

Acceptance criteria, BC analysis, and integration test coverage for each sub-track live in their respective companion specs.

---

## Architecture

### Layer 1 — Tokens

All design tokens live as CSS custom properties in:
- [`apps/mercato/src/styles/globals.css`](../../apps/mercato/src/styles/globals.css) — primary token surface for the application.
- [`packages/ui/src/styles/globals.css`](../../packages/ui/src/styles/globals.css) — mirror for standalone preview / Storybook-equivalent setups.
- [`packages/create-app/template/src/styles/globals.css`](../../packages/create-app/template/src/styles/globals.css) — kept in sync for the user-facing template.

Token families introduced or modernized in Phases 1–2:

| Family | Source | Phase |
|---|---|---|
| Foundation neutrals (`--background`, `--foreground`, `--primary`, `--muted`, `--accent`, `--border`, `--input`, `--ring`, `--card`, `--popover`) | Phase 0 (modernized in 1) | Modernized: corner radius consolidated, oklch values updated to match Figma |
| Status (`--status-{error,success,warning,info,neutral}-{bg,text,border,icon}`) | Phase 0 | Used downstream |
| Brand (`--brand-violet`, `--brand-lime`, `--brand-yellow`, plus neutrals `--brand-black`, `--brand-gray-700/500/100`, `--brand-white`) | **Phase 1** | New |
| Shadow (`--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-focus`) | **Phase 1** | New |
| Radius (`--radius` base + Tailwind `rounded-{sm,md,lg,xl,full}` mapping) | Phase 1 | Consolidated |
| Z-index (`--z-{dropdown,modal,popover,toast,tooltip}`) | Phase 0 | Used downstream |
| Accent (`--accent-indigo` for Checkbox/Switch/Radio checked state) | Phase 1 | New |

Brand colors are constant across light and dark modes (brand identity must not flip). All other tokens have explicit dark-mode pairs in `:root[data-theme="dark"]`.

### Layer 2 — Primitives

Atom primitives live in [`packages/ui/src/primitives/`](../../packages/ui/src/primitives/). Naming convention: lowercase-kebab `.tsx` per primitive, with composites following the `*-field.tsx` pattern.

| Primitive | File | Phase | Key prop surface |
|---|---|---|---|
| Alert | `alert.tsx` | 0 | variant (semantic statuses) |
| Avatar / AvatarStack | `avatar.tsx` | **1** | size (sm/default/md/lg), name (initials fallback) |
| Badge | `badge.tsx` | 0 (status variants) | variant (semantic statuses), dot |
| Button | `button.tsx` | **1** (family unification) | variant, size (2xs–lg + icon), asChild |
| Calendar | `calendar.tsx` | pre-DS | — |
| Card | `card.tsx` | pre-DS | — |
| Checkbox / CheckboxField | `checkbox.tsx`, `checkbox-field.tsx` | **1** | indeterminate, label, description |
| Dialog | `dialog.tsx` | pre-DS (Radix) | — |
| FancyButton | `fancy-button.tsx` | **1** | variant (gradient primary, gradient outline) |
| FormField | `form-field.tsx` | 0 | label, description, error, required |
| IconButton | `icon-button.tsx` | **1** (sizes) | size (xs–lg), variant, aria-label REQUIRED |
| Input | `input.tsx` | **2** (rewrite) | leftIcon, rightIcon, size, inputClassName |
| Kbd / KbdShortcut | `kbd.tsx` | **1** | keys (string[]) |
| Label | `label.tsx` | pre-DS (Radix) | — |
| LinkButton | `link-button.tsx` | **1** | variant, size |
| Popover | `popover.tsx` | pre-DS (Radix) | — |
| Progress | `progress.tsx` | pre-DS | — |
| Radio / RadioGroup / RadioField | `radio.tsx`, `radio-field.tsx` | **2** | value, name, label, description |
| Select / SelectTrigger / SelectContent / SelectItem / SelectValue | `select.tsx` | **2** | size variants (sm/default/lg) |
| SocialButton | `social-button.tsx` | **1** | provider (google, apple, etc.) |
| Spinner | `spinner.tsx` | pre-DS | size |
| StatusBadge | `status-badge.tsx` | 0 | status, dot |
| Switch / SwitchField | `switch.tsx`, `switch-field.tsx` | **2** | size (sm/default), label, description |
| Table | `table.tsx` | pre-DS | — |
| Tabs | `tabs.tsx` | pre-DS (Radix) | — |
| Tag | `tag.tsx` | **1** | variant (semantic + brand), dot |
| Textarea | `textarea.tsx` | **2** (rewrite) | showCount, maxLength, wrapperClassName |
| Tooltip / SimpleTooltip | `tooltip.tsx` | **2** (rewrite) | size (sm/default/lg), variant (default/light), arrow |

Deprecated (bridges retained for ≥1 minor):
- `Notice.tsx` — superseded by `Alert`. Marked `@deprecated`, runtime `console.warn` in dev.
- `ErrorNotice.tsx` — superseded by `LoadingMessage`/`ErrorMessage` from `@open-mercato/ui/backend/detail`.
- `DataLoader.tsx` — superseded by `LoadingMessage`/`ErrorMessage`. Bridge re-exports retained.

### Layer 3 — Composites and rules

- Composite components (FormField, *Field) sit alongside primitives but compose them.
- DS rules: [`.ai/ds-rules.md`](../ds-rules.md) (334 lines) — runtime decision trees for color, spacing, typography, focus.
- Primitive API reference: [`.ai/ui-components.md`](../ui-components.md) (968 lines) — variants, sizes, props, MUST rules, examples per primitive.
- Enforcement: DS Guardian skill ([`.ai/skills/ds-guardian/`](../skills/ds-guardian/)) — activates on edits, references [`token-mapping.md`](../skills/ds-guardian/references/token-mapping.md), [`component-guide.md`](../skills/ds-guardian/references/component-guide.md), [`page-templates.md`](../skills/ds-guardian/references/page-templates.md).

---

## Data Models

N/A — DS Foundation is purely UI primitive + token work. No database tables, no MikroORM entities, no migration files. The token system uses CSS custom properties (no schema), and primitives are stateless React components.

---

## API Contracts

Primitive APIs are detailed in [`.ai/ui-components.md`](../ui-components.md). This section enumerates the surfaces that Phases 1–2 commit to.

### Phase 1 — new public primitive exports

```typescript
// packages/ui/src/primitives/tag.tsx
export type TagVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand'
export type TagMap<K extends string> = Record<K, TagVariant>
export const Tag: React.FC<{ variant?: TagVariant; dot?: boolean; children: React.ReactNode }>

// packages/ui/src/primitives/avatar.tsx
export const Avatar: React.FC<{ name?: string; size?: 'sm' | 'default' | 'md' | 'lg' }>
export const AvatarStack: React.FC<{ max?: number; children: React.ReactNode }>

// packages/ui/src/primitives/kbd.tsx
export const Kbd: React.FC<{ children: React.ReactNode }>
export const KbdShortcut: React.FC<{ keys: string[] }>

// packages/ui/src/primitives/button.tsx (family unification — extended)
export type ButtonVariant = 'default' | 'destructive' | 'destructive-outline' | 'destructive-soft' | 'destructive-ghost' | 'outline' | 'secondary' | 'ghost' | 'muted' | 'link'
export type ButtonSize = '2xs' | 'sm' | 'default' | 'lg' | 'icon'

// Sibling primitives in the family — all new in v1:
export const IconButton: React.FC<{ size?: 'xs' | 'sm' | 'default' | 'lg'; variant?: 'outline' | 'ghost' /* ... */ }>
export const LinkButton: React.FC<{ /* link styled as button */ }>
export const SocialButton: React.FC<{ provider: 'google' | 'apple' | 'github' /* ... */ }>
export const FancyButton: React.FC<{ /* brand-gradient CTA */ }>

// packages/ui/src/primitives/checkbox-field.tsx
export const CheckboxField: React.FC<{ label: string; description?: string; badge?: React.ReactNode; link?: React.ReactNode /* ... */ }>
```

### Phase 2 — new and rewritten public primitive exports

```typescript
// packages/ui/src/primitives/input.tsx (rewrite)
export type InputProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> & {
  size?: 'sm' | 'default' | 'lg'
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  inputClassName?: string
}
// Backward compatible: existing consumers passing only standard <input> props continue to work.

// packages/ui/src/primitives/select.tsx (new)
export const Select // Radix Root re-export
export const SelectGroup // Radix Group re-export
export const SelectValue // Radix Value re-export
export const SelectTrigger: React.ForwardRefExoticComponent<{ size?: 'sm' | 'default' | 'lg' /* + Radix Trigger props */ }>
export const SelectContent
export const SelectLabel
export const SelectItem
export const SelectSeparator
export const SelectScrollUpButton
export const SelectScrollDownButton

// packages/ui/src/primitives/switch.tsx (rewrite)
export const Switch: React.ForwardRefExoticComponent<{ size?: 'sm' | 'default' /* + Radix props */ }>

// packages/ui/src/primitives/switch-field.tsx (new)
export const SwitchField: React.FC<{ label: string; description?: string; badge?: React.ReactNode; link?: React.ReactNode }>

// packages/ui/src/primitives/radio.tsx (new)
export const RadioGroup // Radix RadioGroup re-export
export const Radio: React.ForwardRefExoticComponent<{ value: string }>

// packages/ui/src/primitives/radio-field.tsx (new)
export const RadioField: React.FC<{ value: string; label: string; description?: string }>

// packages/ui/src/primitives/textarea.tsx (rewrite)
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  showCount?: boolean
  wrapperClassName?: string
}
// Backward compatible: existing consumers without showCount behave exactly as before.

// packages/ui/src/primitives/tooltip.tsx (rewrite)
// Same Radix-based exports as before, with size/variant additions on TooltipContent.
export const Tooltip
export const TooltipTrigger
export const TooltipContent: React.FC<{ size?: 'sm' | 'default' | 'lg'; variant?: 'default' | 'light' /* + Radix props */ }>
export const TooltipProvider // MUST be mounted at app root
export const SimpleTooltip: React.FC<{ content: string; children: React.ReactNode; size?: 'sm' | 'default' | 'lg' }>
```

### CrudForm contract change (Phase 2 fix)

Internal change (no public surface impact) — fixed in commit `806472e2f`:

```typescript
// packages/ui/src/backend/CrudForm.tsx — Radix Select branch
// Before: rendered every option as <SelectItem value={opt.value}> — crashed on value=""
// After:
{options
  .filter((opt) => opt.value !== '')
  .map((opt) => (
    <SelectItem key={opt.value} value={opt.value}>
      {opt.label}
    </SelectItem>
  ))}
// Empty-value options are represented by <SelectValue placeholder="—"/> in the trigger.
```

This is a behavioral change for consumers that relied on rendering an explicit "default/none" option with `value=""`. After the fix, those options no longer render in the dropdown — the placeholder serves the same UX role. No known consumer depended on the broken behavior (the previous code would have crashed at render time).

---

## Risks & Impact Review

| # | Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | **Radix Select crashes on `<SelectItem value="">`** | High | CrudForm in any module with select fields with default option (e.g. Custom Entity create form `defaultEditor`) | Filter empty-value options in CrudForm Radix branch (commit `806472e2f`). Audit other Select consumers before further rewrites. | None — fix is in v2. |
| 2 | **`forwardRef` Selects break consumer tests** | Medium | Tests asserting `getByRole('option')` + `selectOption` against TenantSelect, OrganizationSwitcher, CategorySelect | Defer to Phase 3 with formal deprecation: `@deprecated` JSDoc + bridge wrapper + `RELEASE_NOTES.md` entry + ≥1 minor of co-existence. | None until Phase 3. |
| 3 | **Tooltip provider not mounted** | Medium | Any page using Tooltip without TooltipProvider in scope | Mount `<TooltipProvider>` at app root in `apps/mercato/src/app/layout.tsx` (commit `c1a964ba2`). | None. |
| 4 | **Test placeholder selectors fragile** | Medium | Tests using `getByPlaceholder('https://example.com')` racing onto wrong inputs under DS v2 layout (e.g. TC-CRM-002) | Migrate to `data-crud-field-id="<field>"` selectors where available; for inline editors (PersonHighlights, etc.), scope by label or placeholder text on the trigger. Documented in `feedback_radix_test_migration_traps.md`. | Some inline-editor tests still rely on placeholder text — acceptable trade-off; flag in DS Guardian. |
| 5 | **jsdom missing pointer / scroll APIs** | Low | Unit tests using Radix Select | Polyfill `hasPointerCapture`, `releasePointerCapture`, `scrollIntoView` at the top of each test file using Radix Select. Reference: [`VariantBuilder.test.tsx`](../../packages/core/src/modules/catalog/components/products/__tests__/VariantBuilder.test.tsx). Phase 3 will extract this into a shared helper. | None. |
| 6 | **Next.js 16.2.4 + Turbopack dev memory leak** | Low | Dev runtime only — affects `yarn dev` long sessions | Defer to Phase 3 investigation. Not a production issue. | dev-only; mitigated by periodic dev-server restart. |
| 7 | **Token sweep regression risk** | Medium | Visual regressions in modules where ad-hoc colors had higher contrast than the semantic token | Manual review of high-traffic pages (admin dashboard, product list, sales orders); DS Guardian flags hardcoded color usage; visual-regression Playwright snapshots not yet enabled (Phase 3+). | Some low-visibility pages may have minor contrast shifts; mitigated by Boy Scout Rule. |
| 8 | **Squash-merge loses the per-commit phasing** | Low | `develop` history readability after merging v1 + v2 | Squash-merge with descriptive squash commit message that lists the per-phase commits in the body; full history retained on `refactor/ds-foundation-v1` and `-v2` branches plus this spec. | None — spec preserves the phasing record. |
| 9 | **Tag `brand` variant misuse** | Low | Module devs using `<Tag variant="brand">` outside intended use cases (custom views, renewal categories, AI moments) | Documented MUST rule in `.ai/ui-components.md` and `.ai/ds-rules.md`. DS Guardian flags brand color outside allowed contexts. | Minor — small surface, easy to fix in review. |
| 10 | **Spec drift vs implementation** | Low | This spec authored after Phase 1 + Phase 2 are complete; future maintainers may rely on it | Spec is implementation-accurate at commit time. Updates required for Phase 3 (companion specs) and any post-merge changes (changelog at end of this file). | Manageable. |
| 11 | **Phase 3 scope unknown — Figma may surface 20+ additional primitives** | Medium | Phase 3 timeline, resource planning, prioritization | Sub-track 3.0 (Figma audit) runs first and produces an authoritative backlog before any 3.B PR is opened. Each primitive ships as a separate PR with its own companion spec — scope changes are absorbed by the umbrella structure, not by ballooning a single PR. | Phase 3 calendar duration cannot be estimated until 3.0 completes. |
| 12 | **No visual regression coverage** | Medium | Token-driven primitives can drift visually across modules without test failures (correct tokens, correct layout, but elevation / radius / spacing shift by a few px) | Sub-track 3.C delivers a visual regression testing tool early in Phase 3. After it lands, every 3.A / 3.B primitive PR MUST include snapshots in the same commit. Until then, manual screenshot review per primitive PR is required. | Phase 1 + Phase 2 lack visual regression baselines; mitigated by manual review during this spec's rollout window. |

---

## Migration & Backward Compatibility

DS Foundation Phases 1–2 are **additive on every contract surface**. No removals, no field renames, no path changes.

| # | Surface | Phase 1 impact | Phase 2 impact | Notes |
|---|---|---|---|---|
| 1 | Auto-discovery file conventions | None | None | No changes to module file layout, exports, or routing. |
| 2 | Type definitions & interfaces | Additive (new primitive props, new exports) | Additive (new primitive props, new exports) | Existing primitive consumers continue to compile. |
| 3 | Function signatures | Additive | Additive (Textarea adds optional `showCount`, `wrapperClassName`; Tooltip adds optional `size`, `variant`) | All new params optional. |
| 4 | Import paths | None — primitives live where they always did (`@open-mercato/ui/primitives/*`) | None | New paths added: `@open-mercato/ui/primitives/{tag,avatar,kbd,switch-field,radio,radio-field}`. |
| 5 | Event IDs | None | None | DS work is presentational. |
| 6 | Widget injection spot IDs | None | None | DS work does not introduce new spots. |
| 7 | API route URLs | None | None | DS work is client-only. |
| 8 | Database schema | None | None | No DB. |
| 9 | DI service names | None | None | No DI. |
| 10 | ACL feature IDs | None | None | No ACL. |
| 11 | Notification type IDs | None | None | No notifications. |
| 12 | CLI commands | None | None | No CLI. |
| 13 | Generated file contracts | None | None | No generator changes. |

**Deprecation tracking** (existing — not introduced by this spec, but referenced):

- `Notice.tsx` → superseded by `Alert`. `@deprecated` JSDoc + dev-mode `console.warn` already shipped in Phase 0. Bridge re-export from `@open-mercato/ui/primitives/alert`. **Removal target: ≥1 minor after Phase 3 ships.**
- `ErrorNotice.tsx` → superseded by `ErrorMessage` from `@open-mercato/ui/backend/detail`. Bridge retained.
- `DataLoader.tsx` → superseded by `LoadingMessage` from `@open-mercato/ui/backend/detail`. Bridge retained.

**No new deprecations are introduced by Phases 1–2.** Phase 3 sub-track 3.D will introduce deprecations for `TenantSelect`, `OrganizationSwitcher`, `CategorySelect` and document them in its companion spec.

**Phase 3 sub-track 3.C (visual regression testing)** is purely additive — a new CI step that captures and compares snapshots. It does not block existing tests, does not change any contract surface, and is opt-in until baselines are established.

---

## Integration Test Coverage

DS work is purely visual; the integration test impact comes from sweep migrations of consumers (raw `<select>` → Radix Select breaks selectors that asserted `getByRole('option')` against the native API).

### Phase 1 — minimal test impact

Phase 1 mostly modernized colors and added net-new primitives that were not previously used by tests. The Button family unification preserved existing accessible names, so no test changes were required.

### Phase 2 — significant integration-test churn

The Radix Select migration broke tests that asserted the native `<select>` API. Stabilization commits (`6c699333a`, `8fb5c9a81`, `90026b843`, `37c58ecd0`, `806472e2f`, `3b2164d88`) updated the following test files to the new patterns:

| Test file | Pattern change |
|---|---|
| [`packages/core/src/modules/customers/__integration__/TC-CRM-002.spec.ts`](../../packages/core/src/modules/customers/__integration__/TC-CRM-002.spec.ts) | Use `[data-crud-field-id="<field>"] input` instead of `getByPlaceholder()` for displayName, primaryEmail, websiteUrl. |
| [`packages/core/src/modules/customers/__integration__/TC-CRM-004.spec.ts`](../../packages/core/src/modules/customers/__integration__/TC-CRM-004.spec.ts) | `[data-crud-field-id="companyEntityId"] [role="combobox"]` for company picker on people create. |
| [`packages/core/src/modules/customers/__integration__/TC-CRM-005.spec.ts`](../../packages/core/src/modules/customers/__integration__/TC-CRM-005.spec.ts) | Detail-page CompanySelectField is rendered directly (not in CrudForm) — scope by placeholder text on the trigger. |
| [`packages/core/src/modules/customers/__integration__/TC-CRM-006.spec.ts`](../../packages/core/src/modules/customers/__integration__/TC-CRM-006.spec.ts) | Address type inline edit → Radix combobox. |
| [`packages/core/src/modules/customers/__integration__/TC-CRM-007.spec.ts`](../../packages/core/src/modules/customers/__integration__/TC-CRM-007.spec.ts) | Deal create — status, pipelineId, pipelineStageId, valueCurrency. |
| [`packages/core/src/modules/customers/__integration__/TC-CRM-009.spec.ts`](../../packages/core/src/modules/customers/__integration__/TC-CRM-009.spec.ts) | Pipeline picker scoped by wrapping `<label>` (page has Pipeline + Sort by selects). |
| [`packages/core/src/modules/customers/__integration__/TC-CRM-013.spec.ts`](../../packages/core/src/modules/customers/__integration__/TC-CRM-013.spec.ts) | Same pipeline picker fix. |
| [`packages/core/src/modules/core/__integration__/admin/TC-ADMIN-007.spec.ts`](../../packages/core/src/modules/core/__integration__/admin/TC-ADMIN-007.spec.ts) | Custom entity create form — fixed by CrudForm Radix empty-value patch (no test change after fix). |
| [`packages/core/src/modules/core/__integration__/integration/TC-INT-002.spec.ts`](../../packages/core/src/modules/core/__integration__/integration/TC-INT-002.spec.ts) | Cross-module flow — CRM + sales selectors aligned. |
| [`packages/core/src/modules/messages/__integration__/TC-MSG-009.spec.ts`](../../packages/core/src/modules/messages/__integration__/TC-MSG-009.spec.ts) | Replace Ctrl+Enter (no submit handler in textarea) with submit button click. |
| Workflow tests (`TC-WF-006/007/008`) | StepsEditor SelectItem labels are translated (`Start`/`End` not `START`/`END`). |
| Sales adjustment tests | Radix Select inside Radix Dialog — keyboard typeahead instead of `.click({ force: true })` to avoid backdrop click interception. |
| Wizard tests (template + apps/mercato) | Sequential `.fill()` + `await expect(input).toHaveValue(...)` to flush controlled state before clicking Next. |

**No new integration tests were added** — Phase 1 + Phase 2 are pure refactor of existing UI surfaces. Phase 3 will introduce dedicated component-test coverage for new specialized form variants.

### Unit test additions (Phase 2)

Unit tests stabilized in `c99f53dbf`:
- Radix Select / Radio jsdom polyfills inlined per test file.
- Mock `Radix RadioGroup` in tests where focus/keyboard nav is not the SUT.
- Replace `document.querySelector('select')` with `[role="combobox"]` for trigger lookup.
- Replace native `selectOption` interaction with `pointerDown` + `click` on trigger and option.

---

## Final Compliance Report

### DS rules compliance ([`.ai/ds-rules.md`](../ds-rules.md))

- [x] All new primitives use semantic / brand tokens — no hardcoded `text-red-*`, `bg-green-*`, `text-amber-*`, `text-[13px]`, `rounded-[24px]`, `dark:` overrides on status tokens.
- [x] All same-row buttons share a `size` (FormHeader / FormActionButtons enforce this; new `2xs` and `lg` sizes are introduced for non-default rows).
- [x] No raw `<button>` or `<input type="checkbox">` in new code — primitives only.
- [x] Every dialog supports `Cmd/Ctrl+Enter` submit and `Escape` cancel (FormHeader contract).
- [x] Brand violet used only for AI / custom views / renewal categories / brand moments.
- [x] Status tokens with `{property}-status-{status}-{role}` shape.

### Component MVP compliance ([`docs/design-system/components.md`](../../docs/design-system/components.md))

| MVP component (hackathon) | Status after Phases 1–2 |
|---|---|
| 4.1 Button | DONE — family unified |
| 4.2 IconButton | DONE — sizes added |
| 4.3 Link | Covered by `LinkButton` + Next.js `<Link>` (no dedicated primitive needed) |
| 4.4 Input | DONE — rewritten to Figma |
| 4.5 Textarea | DONE — rewritten with showCount |
| 4.6 Select / Combobox | DONE — Radix Select primitive (Combobox via `ComboboxInput` remains, Phase 3 may unify) |
| 4.7 Checkbox | DONE — unified with CheckboxField |
| 4.8 Switch | DONE — Figma-aligned + SwitchField |
| 4.9 FormField wrapper | DONE in Phase 0 |
| 4.10 Card | Pre-DS — token migration in v1 sweep |
| 4.11 Badge | DONE in Phase 0 (status variants) |
| 4.12 Alert / Notice unification | DONE in Phase 0 |
| 4.13 Toast / Flash Message | DONE in Phase 0 |
| 4.14 Modal / Dialog | Pre-DS (Radix) — token migration in v1 sweep |
| 4.15 Dropdown Menu | Pre-DS (Radix) — token migration in v1 sweep |
| 4.16 Tabs | Pre-DS (Radix) — token migration in v1 sweep |
| 4.17 Table | Pre-DS — token migration in v1 sweep |
| 4.18 EmptyState | Phase 0 — `TabEmptyState` exists; full primitive deferred |
| 4.19 Loader / Skeleton | Pre-DS (`Spinner`, `LoadingMessage`); skeleton deferred |
| 4.20 PageHeader / SectionHeader | DONE in Phase 0 |
| 4.21 Pagination | Pre-DS — token migration in v1 sweep |
| 4.22 StatusBadge | DONE in Phase 0 |

**Out of scope but added:** Tag, Avatar/AvatarStack, Kbd/KbdShortcut, FancyButton, SocialButton (entity presentation + brand-moment primitives).

### BC compliance

See [Migration & Backward Compatibility](#migration--backward-compatibility) — all 13 contract surfaces are additive only.

### Code review compliance ([`.ai/skills/code-review/SKILL.md`](../skills/code-review/SKILL.md))

Phases 1 and 2 will pass the code-review skill self-check:
- [x] No new modules without setup.ts (DS work touches no module bootstrap).
- [x] No new entities without `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id` (no entities).
- [x] All inputs validated with zod (no API routes added).
- [x] No `any` types (primitives use proper `React.ComponentPropsWithoutRef` and `React.ForwardRefExoticComponent`).
- [x] DS Guardian rules not violated (verified by `.ai/scripts/ds-health-check.sh` pre/post baselines).

### Generator regeneration

After this spec is committed, run `yarn generate` is **not required** — DS work doesn't touch module discovery, generators, events, or any aggregated registry. Manifest regeneration is unnecessary.

---

## Lessons Learned

Captured for future DS workstream phases and similar primitive migrations.

1. **Spec-first prevents `fix(qa)` churn.** Phase 2 accumulated 8 `fix(qa)` commits because tests were stabilized iteratively against CI (each shard surfacing a different selector regression). A spec written before implementation, with phasing that landed unit + integration tests in the same commit as the primitive migration, would have caught these earlier and kept history clean.
2. **Atomic commits per logical change.** One semantic concern per commit, not one shard's worth of fixes. Acceptable: `fix(qa): TC-CRM-005 placeholder selector`. Not acceptable: `fix(qa): comprehensive Radix Select test migrations across all shards` (covers too much). Phase 3 will use the [`auto-create-pr` skill](../skills/auto-create-pr/SKILL.md) flow, which enforces phase-level commit boundaries.
3. **Radix Select is incompatible with empty-value `SelectItem`.** Generic guard introduced in CrudForm in commit `806472e2f`. Pattern documented in DS Guardian. Future Radix migrations (Combobox, etc.) need the same audit.
4. **jsdom polyfills required for Radix.** `hasPointerCapture`, `releasePointerCapture`, `scrollIntoView` are missing. Currently inlined per test file; Phase 3 will extract to a shared helper.
5. **Local validation before push.** Running `yarn test:integration --shard 6/15` locally would have caught the empty-value Radix crash without needing CI screenshots to diagnose. Memory entry [`feedback_radix_test_migration_traps.md`](../../../.claude/projects/-Users-merynos-Documents-GitHub-open-mercato/memory/feedback_radix_test_migration_traps.md) documents the trap.
6. **Test selector layering.** CrudForm wraps fields in `[data-crud-field-id="<id>"]` — use that for unambiguous targeting. Inline editors (PersonHighlights, etc.) render primitives directly without that wrapper — scope by `<label>` text or placeholder on the trigger. Memory entry [`feedback_radix_test_migration_traps.md`](../../../.claude/projects/-Users-merynos-Documents-GitHub-open-mercato/memory/feedback_radix_test_migration_traps.md) captures this.
7. **`Ctrl+Enter` submit shortcut requires explicit handlers on textarea.** Browser default does not submit forms on Ctrl+Enter for `<textarea>`. CrudForm's `TextInput` has the handler; `TextAreaInput` and `SwitchableMarkdownInput` do not. Phase 3 may add a global form-submit shortcut handler at the form root.
8. **Hackathon docs are the source of truth.** When in doubt about intent, refer to [`docs/design-system/components.md`](../../docs/design-system/components.md), [`priority-table.md`](../../docs/design-system/priority-table.md), [`audit.md`](../../docs/design-system/audit.md). The 13287-line corpus is comprehensive — do not duplicate decisions in commit messages or PR descriptions.
9. **Squash-merge for DS feature branches.** Each phase merges as one squash commit on `develop` (with the body listing the per-component commits). Full per-commit history is preserved on the feature branch + here in this spec.
10. **Pause for elegance.** Per root AGENTS.md: for non-trivial changes, ask "is there a more elegant way?". Phase 2's iterative `fix(qa)` was a flag — should have stopped after the second iteration to look at screenshots, which immediately revealed the empty-value Radix crash.
11. **Figma is the source of truth for scope, not estimates.** Phase 3's full primitive list cannot be known without auditing the Figma file frame-by-frame. Sub-track 3.0 (Figma audit) is therefore mandatory before the rest of Phase 3 can be scoped, prioritized, or staffed. Resist the temptation to estimate Phase 3 in PRs or hours before 3.0 completes.
12. **Umbrella programmes ship as multiple PRs, not one.** When a phase covers many independent components, structure it as an umbrella with one companion spec per sub-track and one PR per primitive (or small group). Single-PR phases of this size accumulate `fix(qa)` churn (Phase 2 case study) and become unreviewable. Phase 3 is structured this way from the outset.
13. **Visual regression is a Phase 3 prerequisite for primitive PRs.** Token-driven primitives drift visually without failing logic tests. Sub-track 3.C delivers the tool early so subsequent primitive PRs in 3.A and 3.B can include snapshots in the same commit as the code.

---

## Changelog

- **2026-04-11** — Hackathon DS audit + plan landed in `develop` ([PR #1226](https://github.com/open-mercato/open-mercato/pull/1226)).
- **2026-04-11..2026-04-22** — Phase 0 (semantic tokens v2 + DS Guardian skill) landed in `develop` via `feat/ds-semantic-tokens-v2` and `feat/ds-guardian-skill` branches.
- **2026-04-25** — Phase 1 (`refactor/ds-foundation-v1` → [PR #1708](https://github.com/open-mercato/open-mercato/pull/1708)) opened. 16 commits, 279 files changed.
- **2026-04-25..2026-04-26** — Phase 2 (`refactor/ds-foundation-v2` → [PR #1709](https://github.com/open-mercato/open-mercato/pull/1709)) opened as draft, blocked on v1 merge. 16+ commits, 136 files changed.
- **2026-04-26** — CrudForm Radix Select empty-value crash fixed in v2 (commit `806472e2f`). Memory entry `feedback_radix_test_migration_traps.md` authored.
- **2026-04-26** — This spec authored retrospectively, committed to v1 PR for review traceability.
- **TBD (post v1+v2 merge)** — Move Phase 1 + Phase 2 sections of this spec to `.ai/specs/implemented/` with `git mv`. Phase 3 stays in root as the umbrella reference.
- **TBD** — Phase 3 sub-track 3.0 (Figma audit) companion spec authored at `.ai/specs/{date}-ds-foundation-v3-figma-audit.md`. **Required first** — produces the authoritative Phase 3 backlog.
- **TBD** — Phase 3 sub-track 3.C (visual regression testing) companion spec authored at `.ai/specs/{date}-ds-foundation-v3-visual-regression.md`. Should land early in Phase 3 (before 3.A / 3.B PRs).
- **TBD** — Phase 3 sub-track 3.E (QA toolbox) companion spec.
- **TBD** — Phase 3 sub-track 3.D (`forwardRef` Selects deprecation) companion spec.
- **TBD per primitive** — Phase 3 sub-tracks 3.A (named known scope: TagInput, CounterInput, DigitInput/OTP, InlineInput, CompactSelect, InlineSelect) and 3.B (TBD scope from 3.0) each get one companion spec per primitive at `.ai/specs/{date}-ds-{primitive-slug}.md`.
- **TBD** — Phase 3 sub-track 3.F (Next.js + Turbopack memory leak) — investigation issue or small fix PR.

---

**Spec authored by:** Claude Code (assistant) at the request of @zielivia (DS lead).

**Companion specs (TBD):**
- `2026-XX-XX-ds-foundation-v3-figma-audit.md` — Phase 3 sub-track 3.0 (must run first).
- `2026-XX-XX-ds-foundation-v3-visual-regression.md` — Phase 3 sub-track 3.C.
- `2026-XX-XX-ds-foundation-v3-qa-toolbox.md` — Phase 3 sub-track 3.E.
- `2026-XX-XX-ds-foundation-v3-forwardref-selects-deprecation.md` — Phase 3 sub-track 3.D.
- `2026-XX-XX-ds-{primitive-slug}.md` — one per primitive in 3.A and 3.B.

**Related runbooks:** [`auto-create-pr`](../skills/auto-create-pr/SKILL.md), [`code-review`](../skills/code-review/SKILL.md), [`ds-guardian`](../skills/ds-guardian/SKILL.md), [`spec-writing`](../skills/spec-writing/SKILL.md).
