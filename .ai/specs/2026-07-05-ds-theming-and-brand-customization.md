# DS Theming & Brand Customization for Standalone Apps

- **Status:** Draft — ready for implementation
- **Scope:** OSS (docs + create-app template + CLI)
- **Origin:** Item 3 (execution order) of the DS DX roadmap — see [`2026-07-05-ds-system-guardian-refresh.md`](2026-07-05-ds-system-guardian-refresh.md)
- **Risk:** `risk-low` (all changes additive; no contract surface modified) · **Priority:** `priority-medium`
- **Category:** `feature`, `documentation`

## TLDR

Give standalone-app adopters a first-class, supported path to make an Open Mercato app look like *their* product instead of ours, in three additive pieces:

1. **A "Brand your app" docs page** (`apps/docs/docs/customization/brand-your-app.mdx`) that publishes the **token contract for theming**: which CSS custom properties are safe to override (`--primary` family, Open Mercato brand tokens, `--radius`, font tokens) and which are semantic contracts that must never change (`--status-*`, `--accent-indigo`, the z-index scale, `--shadow-focus`).
2. **A `theme.css` override convention** in the create-app template: a dedicated, user-owned file imported *after* `globals.css` in `src/app/layout.tsx`, so brand overrides survive framework upgrades — `globals.css` stays framework-owned and can be rewritten wholesale by upgrade tooling.
3. **A `mercato theme init` CLI command** that generates `theme.css` from `--primary "#0C71C6"` (plus optional `--radius`, `--font`), deriving hover/foreground/dark-mode values and **validating WCAG 2.1 contrast** — hard failure below 4.5:1 for text-on-primary, warning below 3:1 for UI-component pairs.

Nothing existing changes behavior. An app that never runs `theme init` and never touches `theme.css` renders pixel-identical to today.

## Overview

The design system already has the right substrate for theming: every color, radius, and font in the UI resolves through CSS custom properties defined in `globals.css`, and Tailwind 4's `@theme inline` block maps utilities onto those properties at runtime (`--color-primary: var(--primary)`, `--radius-lg: var(--radius)`, `--font-sans: var(--font-geist-sans)`). What is missing is not a mechanism but a *boundary*: a declared split between identity tokens an adopter may restyle and semantic tokens the component ecosystem depends on, plus a file layout where the former live in adopter-owned CSS and the latter stay framework-owned.

This spec draws that boundary and ships the three artifacts that make it usable — the documented contract, the `theme.css` slot, and a generator that produces a correct theme (readable contrast, dark mode included) instead of leaving adopters to hand-derive five interdependent values from one brand hex.

## Problem Statement

Standalone apps scaffolded by `create-mercato-app` ship with the Open Mercato default theme: near-black `--primary`, `0.625rem` `--radius`, system font stacks, and the lime/violet Open Mercato brand accents. Adopters building a branded product on top of the framework today face three gaps:

1. **No documented theming contract.** Every design token lives in `src/app/globals.css` (350+ custom properties across `:root`, `.dark`, and `@theme inline`). Nothing tells an adopter which of those are *identity* (safe to restyle) and which are *semantics* (status colors, selection-control indigo, layering, focus anatomy) that primitives, `.ai/ds-rules.md`, and the DataTable/CrudForm ecosystem depend on. The predictable failure mode: an adopter greps for a color, edits it in place, and breaks the Alert palette or the checkbox ON state without knowing it was load-bearing.
2. **No safe place to put overrides.** The only file defining tokens is `globals.css` — but that file is framework-owned. It is listed in the create-app template sync flow (`packages/create-app/AGENTS.md` requires app-shell files to stay mirrored with `apps/mercato/src/app/**`), and upgrade tooling (`om-auto-upgrade-*` skills, `UPGRADE_NOTES.md` migrations) may rewrite it to pick up new tokens (as happened when the status, z-index, and shadow scales landed). Edits made directly in `globals.css` are lost or conflict on every framework upgrade.
3. **No guardrails on color choices.** Picking a brand primary is easy; picking a *readable* `--primary-foreground` for it is not. Nothing today checks that white text on `#7FB3E0` fails WCAG AA. The framework should compute the safe answer and refuse to generate an unreadable theme.

## Goals / Non-Goals

**Goals**
- One canonical docs page defining the safe-to-theme token surface and the never-touch semantic surface.
- A user-owned `theme.css` in the template (and its `apps/mercato` mirror) with guaranteed cascade ordering after `globals.css`.
- `mercato theme init` generating a validated theme: derived palette (hover, foreground, dark-mode variants), WCAG 2.1 contrast math, clear failure messages.
- Everything additive per `BACKWARD_COMPATIBILITY.md`.

**Non-Goals**
- Runtime/tenant-level theming (per-tenant brand colors from the database) — a future, separate spec; this spec is build-time CSS only.
- A full palette generator for charts (`--chart-*`) or sidebar tokens — documented as advanced manual overrides, not generated.
- Changing any default token value in `globals.css`.
- Theming the docs site or marketing pages.

## Proposed Solution

### 1. Token contract — the theming surface

Verified against `apps/mercato/src/app/globals.css` (identical token blocks in `packages/create-app/template/src/app/globals.css`). The docs page publishes this as two tables.

#### Safe to override (identity tokens)

| Token | Light default | Dark override exists | Effect |
|---|---|---|---|
| `--primary` | `oklch(0.205 0 0)` (near-black) | yes (`oklch(0.922 0 0)`) | Primary buttons, active tab underline, links, `bg-primary/…` tints |
| `--primary-hover` | `oklch(0.145 0 0)` | yes | Primary button hover |
| `--primary-foreground` | `oklch(0.985 0 0)` | yes | Text/icon on primary surfaces |
| `--brand-lime` | `#D4F372` | **no — theme-invariant by design** | Open Mercato brand moments (hero, gradient, celebration) |
| `--brand-violet` / `--brand-violet-foreground` | `oklch(0.55 0.2 293)` / near-white | yes (lightened in `.dark`) | AI touchpoints, custom-view pills |
| `--radius` | `0.625rem` | n/a | Cascades to the whole radius scale (below) |
| `--font-geist-sans` | system UI stack | n/a | Entire app UI font — `@theme inline` maps `--font-sans: var(--font-geist-sans)` |
| `--font-geist-mono` | system mono stack | n/a | Code/technical content font |

Two verified mechanics the docs must explain, because they are what makes plain-CSS theming work:

- **Radius cascade.** `@theme inline` in `globals.css` derives the full scale from the one knob: `--radius-sm: calc(var(--radius) - 4px)`, `--radius-md: calc(var(--radius) - 2px)`, `--radius-lg: var(--radius)`, `--radius-xl: calc(var(--radius) + 6px)`. Overriding `--radius` alone re-rounds every `rounded-sm/md/lg/xl` usage consistently; `rounded-full` and `rounded-none` are unaffected. Values below `4px` clamp `--radius-sm` to zero or negative — the CLI warns below `0.25rem`.
- **`@theme inline` indirection.** Tailwind 4 utilities compile against `--color-primary: var(--primary)` etc., so a *runtime* CSS custom property override in any later-loaded stylesheet retints the compiled utilities without recompiling Tailwind. This is why `theme.css` needs only plain `:root { … }` / `.dark { … }` blocks — no `@theme`, no build config.

The docs page also covers fonts honestly: overriding `--font-geist-sans` switches the family *token*; actually loading a webfont (via `next/font` in `layout.tsx` or `@font-face` in `theme.css`) is the adopter's responsibility, with a short `next/font` example that assigns the loaded font's CSS variable to `--font-geist-sans`.

#### Never override (semantic contracts)

| Surface | Why it is a contract |
|---|---|
| `--status-{error,success,warning,info,neutral,pink}-{bg,text,border,icon}` | Semantic status *roles* consumed by Alert, StatusBadge, Toast, StatusMap definitions across every module. Values are calibrated per Figma state variables with dedicated dark-mode counterparts; `.ai/ds-rules.md` forbids `dark:` overrides precisely because these pairs are pre-balanced. Re-coloring "error" to a brand hue breaks the meaning, not just the look. |
| `--accent-indigo` / `--accent-indigo-foreground` | The selection contract: Checkbox/Radio/Switch ON state and native `accent-color` (`@layer base` wires `input[type=checkbox|radio]`). Deliberately *not* `--primary` so selected controls stay distinguishable from primary actions regardless of brand color. |
| `--z-index-*` scale | Cross-component layering guarantees (`z-popover: 45` above `z-modal: 40` so selects inside drawers render; tooltips above popovers). Any change desynchronizes portaled components. |
| `--shadow-focus` anatomy | The dual-ring focus recipe (`0 0 0 2px var(--focus-ring-inner), 0 0 0 4px var(--focus-ring-outer)`) is an accessibility affordance; only the `--focus-ring-*` inputs are theme-aware, and even those are calibrated per light/dark. |
| `--brand-{apple,github,x,google-stroke,facebook,dropbox,linkedin}` | Third-party brand identities on social-login buttons — theme-invariant and not ours (or the adopter's) to restyle. |
| `--destructive`, `--ring`, `--border`, `--input`, `--muted*`, `--accent*`, `--card*`, `--popover*`, `--sidebar*`, `--chart-*` | Neutral scaffolding and data-viz palette. Overridable in principle, but outside the *supported* contract in v1 — documented as "advanced, at your own risk" with a pointer to `.ai/ds-rules.md`. |

### 2. `theme.css` override convention (create-app template)

New file `packages/create-app/template/src/app/theme.css`, scaffolded into every new standalone app, plus one import line in the template `layout.tsx` immediately after the existing `import './globals.css'`:

```ts
import './globals.css'
import './theme.css'
```

Initial content is inert — a header comment explaining the contract plus fully commented-out example blocks:

```css
/* theme.css — YOUR brand overrides. This file is yours: framework upgrades
 * never touch it. It MUST stay imported after globals.css (source order is
 * what makes these overrides win). Generate a starting point with:
 *   yarn mercato theme init --primary "#0C71C6"
 * Safe tokens: --primary, --primary-hover, --primary-foreground,
 * --brand-lime, --brand-violet(-foreground), --radius, --font-geist-sans/mono.
 * Never override --status-*, --accent-indigo, --z-index-*, --shadow-focus.
 * Full contract: <docs>/customization/brand-your-app */

/* :root { --primary: #0C71C6; --primary-foreground: #ffffff; } */
/* .dark { --primary: #4D9FDD; --primary-foreground: #0a0a0a; } */
```

Design decisions, verified against the current wiring:

- **Import in `layout.tsx`, not `@import` inside `globals.css`.** `globals.css` is framework-owned: the create-app AGENTS.md sync checklist mirrors app-shell files with `apps/mercato/src/app/**`, and upgrade skills may replace it to deliver new token blocks. An `@import './theme.css'` tail line inside it would survive only as long as no upgrade rewrites the file. `layout.tsx` is also synced — but the *template* copy carries the `theme.css` import going forward, so the sync propagates the convention instead of destroying it.
- **Ordering is the mechanism.** `theme.css` loads after `globals.css`, so its `:root`/`.dark` declarations win by source order at equal specificity. The header comment states this explicitly because moving the import above `globals.css` silently disables every override.
- **Monorepo parity.** `apps/mercato/src/app/theme.css` (same inert content) and the matching import in `apps/mercato/src/app/layout.tsx` are added in the same change, per template-sync rule #5 in `packages/create-app/AGENTS.md` — the monorepo app is the reference implementation for the template.
- **Upgrade delivery.** `theme.css` is deliberately *excluded* from the template sync checklist and from `om-auto-upgrade-*` mechanical migrations; `packages/create-app/AGENTS.md` gains one line documenting it as user-owned. Existing standalone apps (scaffolded before this ships) don't have the file or the import — `mercato theme init` handles that (below), and `UPGRADE_NOTES.md` gets a short additive entry describing the two-line adoption.

### 3. `mercato theme init` CLI command

Registered as a new built-in CLI module in `packages/cli/src/mercato.ts` (added to `BUILTIN_CLI_MODULE_IDS` and pushed alongside the existing built-ins such as `deploy`), implementation under `packages/cli/src/lib/theme/`:

```
packages/cli/src/lib/theme/
  init.ts        # command entry: arg parsing, file IO, layout.tsx import check
  palette.ts     # OKLCH conversion + derivation (hover, foreground, dark variants)
  contrast.ts    # WCAG 2.1 relative luminance + contrast ratio (dependency-free)
  __tests__/     # contrast fixtures, palette snapshots, init e2e in tmp dir
```

#### Command contract (API surface — additive, STABLE once shipped)

```
mercato theme init --primary "#0C71C6" [options]

  --primary <hex>              required; brand primary (#RGB, #RRGGBB)
  --primary-foreground <hex>   optional; text-on-primary (default: auto-picked)
  --radius <value>             optional; CSS length for --radius (e.g. 8px, 0.5rem)
  --font <family>              optional; font family for --font-geist-sans
  --out <path>                 optional; default src/app/theme.css
  --force                      overwrite an existing theme.css
  --dry-run                    print the generated CSS + contrast report, write nothing
```

Exit codes: `0` success (warnings allowed), `1` validation failure (contrast below the hard threshold, unparseable color, existing file without `--force`).

#### Palette derivation

All derivation happens in OKLCH (perceptually uniform lightness; matches how `globals.css` already expresses themed tokens):

- **`--primary`** — the input color, emitted as provided.
- **`--primary-hover`** — light mode: lightness − 0.06 (clamped ≥ 0.10), hue/chroma preserved — mirrors the default theme's darker-on-hover relationship (`0.205 → 0.145`).
- **`--primary-foreground`** — unless `--primary-foreground` is given: pick white (`#ffffff`) or near-black (`#0a0a0a`), whichever yields the higher WCAG contrast ratio against `--primary`. Because the worse of the two candidates bottoms out around 4.5:1 only in the mid-luminance valley (relative luminance ≈ 0.18), the auto-pick emits a *warning* when the winning ratio is below 4.5:1 and refuses only when it is below 3:1 (a color that hostile to both black and white does not exist in sRGB, so in practice auto-pick always succeeds — the message exists for correctness).
- **Dark mode block** — always emitted, mirroring the framework's own pattern (dark `--primary` is a *light* color): dark `--primary` = input with lightness raised to ≥ 0.65 (matching how `--brand-violet` shifts `0.55 → 0.65`), dark `--primary-hover` = dark primary − 0.06, dark `--primary-foreground` re-picked and re-validated *independently* against the dark primary. Adopters who want exact control edit the generated `.dark` block by hand; the generator's job is a safe, non-clashing default so dark mode is never forgotten.
- **`--radius` / fonts** — pass-through with validation (radius must parse as a CSS length; warn below `0.25rem` per the cascade clamp above). `--font` emits the token override with the framework's system stack appended as fallback, plus a comment reminding the adopter to actually load the font.

The generator emits **only** tokens from the safe table. It structurally cannot produce `--status-*`, `--accent-indigo`, z-index, or shadow overrides.

#### WCAG contrast math (normative)

Per WCAG 2.1: for each sRGB channel `c ∈ [0,1]`: `c ≤ 0.03928 ? c/12.92 : ((c + 0.055)/1.055)^2.4`; relative luminance `L = 0.2126·R + 0.7152·G + 0.0722·B`; contrast ratio `(L₁ + 0.05)/(L₂ + 0.05)` with `L₁` the lighter. Thresholds applied:

| Pair | Threshold | On violation |
|---|---|---|
| `--primary-foreground` on `--primary` (light **and** dark, each pair checked) | 4.5:1 (AA normal text) | **Fail, exit 1** when explicitly supplied; warn when auto-picked (see above) |
| `--primary` against `--background` (default white / dark `oklch(0.145 0 0)`) | 3:1 (AA non-text UI) | Warn — outline buttons, links, focus-adjacent uses |
| `--brand-violet-foreground` on `--brand-violet` style pairs (when the adopter overrides brand tokens via flags in a follow-up; v1 checks them only if present in an existing `theme.css` being overwritten) | 4.5:1 | Warn |

Failure message is actionable, e.g.:

```
✖ Contrast check failed: --primary-foreground (#ffffff) on --primary (#8FC1E9)
  is 1.9:1 — WCAG AA requires 4.5:1 for text.
  Suggestion: use --primary-foreground "#0a0a0a" (12.1:1), or pick a darker primary.
```

Success prints a small report table (token, value, checked pair, ratio, verdict) for both modes.

#### Existing-app adoption

When `theme.css` is written but `src/app/layout.tsx` does not import it, `init` attempts an idempotent single-line insert directly after the `import './globals.css'` anchor. If the anchor is not found (customized layout), it prints the exact line to add and where — it never rewrites layout structure. This makes the command the upgrade path for pre-existing standalone apps, not just fresh scaffolds.

### 4. Docs page

`apps/docs/docs/customization/brand-your-app.mdx`, registered in `apps/docs/sidebars.ts` under **Customization Tutorials** (after `custom-fields-overview`). Frontmatter follows the existing convention (`title: Brand your app`, one-line `description`). Structure:

1. Quick start — `yarn mercato theme init --primary "#0C71C6"`, before/after screenshot.
2. How theming works — `theme.css` + source order + `@theme inline` indirection (short, honest version of the mechanics above).
3. The token contract — the two tables (safe / never), with the radius-cascade and dark-mode notes.
4. Fonts — token override + `next/font` loading example.
5. What the CLI validates — WCAG thresholds, what failure looks like.
6. Advanced & unsupported — neutral scaffolding tokens, chart palette, and an explicit statement: overrides of `--status-*`, `--accent-indigo`, `--z-index-*`, `--shadow-focus` are **unsupported**; upgrades assume their semantics and support requests with such overrides in place are triaged as self-inflicted.

## Architecture

Files touched (all additive):

| File | Change |
|---|---|
| `apps/docs/docs/customization/brand-your-app.mdx` | New docs page (token contract, mechanics, CLI reference) |
| `apps/docs/sidebars.ts` | Add page to the Customization Tutorials category |
| `packages/create-app/template/src/app/theme.css` | New inert, user-owned override file |
| `packages/create-app/template/src/app/layout.tsx` | Add `import './theme.css'` after `import './globals.css'` |
| `apps/mercato/src/app/theme.css` + `apps/mercato/src/app/layout.tsx` | Monorepo mirrors (template-sync rule #5) |
| `packages/create-app/AGENTS.md` | One line: `theme.css` is user-owned, excluded from template sync |
| `packages/cli/src/mercato.ts` | Register built-in `theme` CLI module (id added to `BUILTIN_CLI_MODULE_IDS`, entry pushed like the existing `deploy` built-in) |
| `packages/cli/src/lib/theme/{init,palette,contrast}.ts` + `__tests__/` | Command implementation (dependency-free; no new production packages) |
| `UPGRADE_NOTES.md` | Additive adoption note for pre-existing standalone apps |

Runtime flow at render time (unchanged infrastructure, new participant):

```
layout.tsx
  ├─ globals.css   (framework-owned: @theme inline + :root/.dark token defaults)
  └─ theme.css     (adopter-owned: :root/.dark overrides — wins by source order)
        ↓
  compiled Tailwind utilities read var(--primary), var(--radius), …
        ↓
  every primitive retints; semantic tokens keep framework defaults
```

`mercato theme init` flow: parse flags → convert `--primary` to OKLCH → derive hover/foreground/dark variants (`palette.ts`) → run WCAG checks on every emitted pair (`contrast.ts`) → on pass, write `theme.css` and ensure the `layout.tsx` import anchor (`init.ts`) → print the contrast report. The command needs no database, DI container, or env bootstrap — it is pure file generation, so it must remain runnable in a freshly scaffolded app before `yarn setup`.

## Data Models

None. No database entities, migrations, or persisted state — all artifacts are files in the adopter's repo.

## API Contracts

No HTTP API changes. The only new contract surface is the CLI command documented above — additive under `BACKWARD_COMPATIBILITY.md` §13 (CLI Commands, STABLE: adding commands is allowed; the flags listed become part of the stable surface once shipped).

## Migration & Backward Compatibility

- **No contract surface changes.** No import paths, types, event IDs, ACL features, DI keys, routes, or DB schema are touched. `BACKWARD_COMPATIBILITY.md` §13 permits adding CLI commands; `theme` + `init` and their flags are new and become STABLE on release.
- **Template change is additive** (per `BACKWARD_COMPATIBILITY.md`'s additive-only posture for scaffolding): one new inert file + one import line. Freshly scaffolded apps render byte-identical CSS output because the shipped `theme.css` contains only comments.
- **Existing standalone apps** are unaffected until they opt in. Adoption = run `mercato theme init` (which inserts the import or tells you how) or add the two lines by hand. A short additive entry in `UPGRADE_NOTES.md` documents this; no `om-auto-upgrade` migration is required because nothing breaks without it.
- **Monorepo** gains the mirrored `apps/mercato/src/app/theme.css` + import, keeping the template-sync checklist honest; the monorepo file stays inert (the framework's own app keeps the default theme).
- **No deprecations.** Direct edits to `globals.css` keep working exactly as today — they were never supported, and this spec finally provides the supported alternative rather than breaking the workaround.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Adopters override `--status-*` / `--accent-indigo` in `theme.css` anyway, then report "broken" alerts/checkboxes after an upgrade | Medium | Standalone apps, support load | Three layers: (1) docs declare these unsupported in plain terms; (2) `theme init` never emits them and **warns** when it detects protected tokens in an existing `theme.css` it is asked to overwrite; (3) the DS guardian skill (`om-ds-guardian`, per the companion refresh spec) treats protected-token overrides in `theme.css` as a flagged violation during reviews. No hard runtime block — it is the adopter's file. | Low — documented-unsupported is the industry-standard posture; a build-time lint could be a follow-up if support tickets materialize |
| Import-order regression: adopter (or a codemod) moves `import './theme.css'` above `globals.css`, silently disabling the brand | Low | Standalone apps | Header comment in `theme.css` states the ordering requirement; docs repeat it; `theme init` re-checks anchor position when run again | Low |
| Mid-luminance primaries (relative luminance ≈ 0.18) pass auto-pick only marginally; brand looks technically-AA but weak | Low | Generated themes | Contrast report always prints exact ratios; warning threshold surfaces marginal pairs (< 4.5:1 auto-picked) with the suggestion string | Low |
| Dark-mode derivation produces an off-brand hue for highly chromatic primaries (OKLCH lightness raise can shift perceived saturation) | Low | Generated themes | `.dark` block is plain editable CSS with a comment inviting manual tuning; `--dry-run` lets adopters iterate before writing | Low |
| Upgrade tooling later rewrites template `layout.tsx` and drops the `theme.css` import | Low | Framework upgrades | The import lives in the template source of truth, so syncs carry it; template scaffold test (below) asserts the import exists, turning a regression into a CI failure | Very low |
| `--radius` extremes (0, very large) degrade component geometry (negative `--radius-sm`, clipped checkboxes) | Low | Generated themes | CLI warns outside `0.25rem–1rem`; docs show the cascade math so the effect is predictable | Low |

Impact on existing behavior: none. All risk is confined to apps that actively opt in.

## Validation Plan

1. **Unit — contrast math** (`packages/cli/src/lib/theme/__tests__/contrast.test.ts`): known WCAG reference pairs (`#ffffff`/`#000000` = 21:1, `#ffffff`/`#767676` ≈ 4.54:1, boundary values around the 0.03928 channel knee), symmetry, and threshold classification.
2. **Unit — palette derivation**: snapshot tests for representative primaries (dark brand color, light pastel, mid-luminance valley color, achromatic gray) asserting emitted tokens, auto-picked foregrounds, dark-block values, and that no protected token ever appears in output.
3. **CLI e2e** (tmp dir): `theme init` writes a parseable file; `--force` semantics; layout.tsx anchor insert is idempotent (running twice yields one import); `--dry-run` writes nothing; exit code 1 on explicit failing foreground.
4. **Template**: `yarn test:create-app` scaffold smoke test extended to assert `src/app/theme.css` exists and `layout.tsx` imports it after `globals.css`; standalone parity via `yarn test:create-app:integration` (Verdaccio) confirming the CLI command resolves in a standalone app (compiled `dist/` path, per `packages/cli/AGENTS.md` standalone considerations).
5. **Manual visual QA** (needs-qa): scaffold an app, run `theme init --primary "#0C71C6" --radius 8px`, verify in light *and* dark mode that primary buttons/links/tabs retint, status alerts and checkbox/radio/switch ON states are *unchanged*, and focus rings render with the standard anatomy.
6. **Docs**: `apps/docs` builds; sidebar entry resolves; code samples in the page copy-paste clean against a fresh scaffold.
7. **Monorepo checks**: `yarn build:packages`, `yarn typecheck`, `yarn lint`, `yarn workspace @open-mercato/cli test`.

## Final Compliance Report

- Contract surfaces: untouched; one additive CLI command (BC §13 compliant). ✔
- Template: additive only; fresh scaffolds render identically until opt-in. ✔
- DS rules: spec introduces no hardcoded colors into components; theming happens exclusively through the existing token indirection; protected semantic tokens remain protected. ✔
- Tenancy/security: no runtime code paths, no tenant data, no new API routes. ✔
- i18n: CLI output is developer tooling (English, consistent with existing CLI messages); the docs page is English per docs convention. ✔

## Changelog

- **2026-07-05** — Initial spec: token contract docs page, `theme.css` override convention in create-app template + monorepo mirror, `mercato theme init` with OKLCH palette derivation and WCAG 2.1 contrast validation.
