# Button Audit — Figma DS vs Code

Status: implemented (Phases 1–5 + 1.5 landed in `refactor/ds-foundation-v1`)
File: Figma `qCq9z6q1if0mpoRstV5OEA` → node `129:1422` (Buttons [1.1])
Scope: 5 button categories from Figma DS reconciled with `@open-mercato/ui` primitives.

This is process documentation — design decisions, trade-offs, and phased plan. Component-level details (variants/sizes/props/MUST rules) live in [`.ai/ds-rules.md`](../ds-rules.md#component-reference).

---

## Figma model — 4 axes (Buttons [1.1])

| Axis | Values |
|---|---|
| Type | `Neutral`, `Error` |
| Style | `Filled`, `Stroke`, `Lighter`, `Ghost` |
| Size | `Medium (40)`, `Small (36)`, `X-Small (32)`, `2X-Small (28)` |
| State | `Default`, `Hover`, `Focus`, `Disabled` |
| Icon mode | text+icon / icon-only (square) |

→ 8 visual variants × 4 sizes × 4 states.

## Variant token map (extracted from Figma)

| Type · Style | Background | Text/Icon | Border | Notes |
|---|---|---|---|---|
| Neutral · Filled | `bg/surface-800` `#262626` | `text/white-0` | — | hover → `bg/strong-950` `#171717` |
| Neutral · Stroke | `bg/white-0` `#fff` | `text/sub-600` `#5c5c5c` | `stroke/soft-200` `#ebebeb` | + `regular-shadow/x-small` |
| Neutral · Lighter | `bg/weak-50` `#f7f7f7` | `text/sub-600` `#5c5c5c` | — | — |
| Neutral · Ghost | transparent | `text/sub-600` `#5c5c5c` | — | — |
| Error · Filled | `state/error/base` `#dc2626` | `static/static-white` | — | — |
| Error · Stroke | `bg/white-0` | `state/error/base` `#dc2626` | error-tinted border | — |
| Error · Lighter | `alpha/red/alpha-10` `#fb37481a` | `state/error/base` `#dc2626` | — | — |
| Error · Ghost | transparent | `state/error/base` `#dc2626` | — | — |
| Disabled (any) | `bg/weak-25` `#f7f7f7` | `text/disabled-300` `#d1d1d1` | `stroke/soft-200` `#ebebeb` | — |
| Focus (any) | (variant bg) | (variant text) | — | shadow: `0 0 0 2px #fff, 0 0 0 4px alpha/slate/alpha-16` |

Typography (all sizes): `Label/Small` — Inter Medium 14/20, letter-spacing −0.6.

## Size tokens

| Size | Height | Padding | Radius (Figma) | Gap | Icon size |
|---|---|---|---|---|---|
| Medium (40) | 40 | `p-10` | `radius-10` (10) | 4 | 20 |
| Small (36) | 36 | `p-8` | `radius-8` (8) | 4 | 20 |
| X-Small (32) | 32 | `p-6` | `radius-8` (8) | 2 | 20 |
| 2X-Small (28) | 28 | `px-6 py-4` | `radius-8` (8) | 2 | 20 |

> **Per-size radius reverted in implementation.** Mixing Medium=10 + Small=8 in paired action rows (Cancel + Save) caused visible mismatch. Code uses uniform `rounded-md` (8px); paired buttons MUST share `size`.

## Mapping: Figma → `Button` code

| Figma variant | Code variant | Status |
|---|---|---|
| Neutral · Filled | `default` | ✅ |
| Neutral · Stroke | `outline` | ✅ |
| Neutral · Lighter | `secondary` | ✅ |
| Neutral · Ghost | `ghost` | ✅ |
| Error · Filled | `destructive` | ✅ |
| Error · Stroke | `destructive-outline` | ✅ added Phase 1 |
| Error · Lighter | `destructive-soft` | ✅ added Phase 1 |
| Error · Ghost | `destructive-ghost` | ✅ added Phase 1 |
| — | `muted` | kept for BC (no Figma counterpart) |
| — | `link` | kept for BC; new code uses `LinkButton` |

## Architectural decision (Option B chosen)

**Option A — Mirror Figma** (intent × style as orthogonal axes): `intent: 'neutral'|'error'` × `style: 'filled'|'stroke'|'lighter'|'ghost'`.
- Pro: matches Figma 1:1, future-proof for `success`/`warning` intents.
- Con: BC break — every existing call site updates.

**Option B — Flat variants** (additive): add `destructive-outline`, `destructive-soft`, `destructive-ghost`.
- Pro: zero BC impact, just new variants.
- Con: combinatorial growth if more intents arrive.

**Decision: Option B for v1.** Rationale: minimal blast radius, zero migration. Re-evaluate if `success`/`warning` intents are added.

## Other Figma button categories

### Link Buttons (Figma node `168:4889`) → `LinkButton` (new component, Phase 3)

5 styles × underline toggle × 2 sizes:
- Style: `Gray`, `Black`, `Primary`, `Error`, `Modifiable`
- Underline: On/Off
- Size: Medium (20px line), Small (16px line)

Tokens (Default state):
- Gray: `text/sub-600` `#5c5c5c`
- Black: `text/strong-950` `#171717`
- Primary: `primary-base` `#6366f1` (indigo — DS brand)
- Error: `state/error/base` `#dc2626`
- Modifiable: `text-current` (inherits from parent)

### Compact Button (Figma node `189:3646`) → `IconButton` (existing, augmented Phase 2)

- Styles: Stroke / Ghost / White / Modifiable (4)
- Sizes Figma: Large (24) / Medium (20) — code keeps 24/28/32/36 range
- States: Default / Hover / Active (`#262626` bg) / Disabled
- `fullRadius` toggle (pill ↔ rounded-md)
- Active state: implemented via `aria-pressed={true}` (auto bg-primary)

### Social Buttons (Figma node `180:4264`) → `SocialButton` (new component, Phase 4)

7 brands × 2 styles × icon-only toggle. Single size (40).

| Brand | Color hex |
|---|---|
| Apple | #000000 |
| GitHub | #181717 |
| X (Twitter) | #000000 |
| Google | white bg + multicolor logo + #DADCE0 stroke |
| Facebook | #1877F2 |
| Dropbox | #0061FF |
| LinkedIn | #0A66C2 |

Brand colors live as theme-invariant tokens in `globals.css`: `--brand-apple`, `--brand-github`, `--brand-x`, `--brand-google-stroke`, `--brand-facebook`, `--brand-dropbox`, `--brand-linkedin`.

### Fancy Buttons (Figma node `181:5291`) → `FancyButton` (new component, Phase 5)

4 types × 3 states × 3 sizes. **No Focus state**, no `2X-Small`.

| Type | Tokens (Default) |
|---|---|
| Neutral | `bg/strong-950` `#171717` + sheen gradient + 1px ring `#242628` + drop shadow `#1B1C1D7A` |
| Basic | `bg/white-0` + `text/sub-600` + 1px ring `#ebebeb` + drop shadow `#0E121B1F` |
| Primary | brand gradient `linear-gradient(161.7deg, brand-lime 0%, #EEFB63 35.36%, brand-violet 70.72%)` + `text-foreground` |
| Destructive | `state/error/base` `#dc2626` + sheen + 1px ring `#dc2626` + drop shadow `#0E121B3D` |

---

## Phased implementation (all landed)

| Phase | Scope | Status |
|---|---|---|
| **1** | `Button` parity: 3 Error variants, `2xs` size, per-size radius (later reverted), `--primary-hover` token | ✅ |
| **1.5** | `--shadow-focus` (Figma 2px white inner + 4px slate-alpha-16 outer), `--bg-disabled`/`--text-disabled`/`--border-disabled` tokens | ✅ |
| **2** | `IconButton`: Active state via `aria-pressed`, `Modifiable` + `White` variants, `fullRadius` prop | ✅ |
| **3** | `LinkButton` new component (5 styles × 2 sizes × underline) | ✅ |
| **4** | `SocialButton` new component (7 brands × 2 styles + brand color tokens) | ✅ |
| **5** | `FancyButton` new component (4 intents × 3 sizes, gradient + dual shadow) | ✅ |

---

## Cross-cutting fixes shipped alongside

- `--accent-indigo` token (#6366f1 light / #818cf8 dark) for selection controls (Checkbox primary checked state).
- Native `accent-color: var(--accent-indigo)` in `@layer base` as safety net for legacy raw `<input type="checkbox">`.
- Migration of raw `<input type="checkbox">` → `Checkbox` primitive in `FilterOverlay`, `AppShell` (×2), `CrudForm` (×3).
- Local app/template `checkbox.tsx` files reduced to re-exports from `@open-mercato/ui/primitives/checkbox` (single source of truth).
- DataTable sort indicator: stacked Unicode `▲▼` → single Lucide `ChevronUp`/`ChevronDown`/`ChevronsUpDown`.
- DataTable toolbar size standardization: removed `size="sm"` from ExportMenu trigger and bulk action buttons; all toolbar buttons now `default` (h-9) to match `size="icon"` (size-9).
- `FormActionButtons`: Cancel `<Link>` → `<Button asChild variant="outline">`; Delete hardcoded red classes → `variant="destructive-outline"`.
- FilterBar search input: removed `sm:max-w-[240px]` truncation, added DS focus ring + token-driven border/shadow.

## Lessons captured (added to `packages/ui/AGENTS.md`)

- "Same-row size consistency" MUST rule + anti-pattern table.
- "1 source of truth for Checkbox" MUST rule with re-export contract.
- Color contract: Checkbox uses `--accent-indigo`, NOT `--primary`.
