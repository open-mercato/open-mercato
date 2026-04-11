# J. Migration Mapping Tables

> Typography and color mapping tables + codemod scripts (ds-migrate-typography.sh, ds-migrate-colors.sh).

---

## J.1 Typography Mapping

### Replacement table

| Current | Replace with | Context | Files | Replacement type |
|---------|-------------|---------|-------|-----------------|
| `text-[9px]` | `text-[9px]` (KEEP) | Notification badge count — 9px is below the minimum scale. Only usage, exception. | 1 | None |
| `text-[10px]` | `text-xs` (12px) | Badge small, compact labels. 2px difference is acceptable — consistency gain. | 15 | Regex: `s/text-\[10px\]/text-xs/g` |
| `text-[11px]` | `text-overline` (new token, 11px) | Uppercase labels, section headers, captions. This is a de facto "overline" pattern used in 33 places — deserves its own token. | 33 | 1. Add token to CSS. 2. Regex: `s/text-\[11px\]/text-overline/g` |
| `text-[12px]` | `text-xs` | Identical to text-xs (12px). 1:1 replacement. | 2 | Regex: `s/text-\[12px\]/text-xs/g` |
| `text-[13px]` | `text-sm` (14px) | Small buttons, links. 1px difference. Consistency gain at the cost of a micro visual change. | 7 | Regex: `s/text-\[13px\]/text-sm/g` |
| `text-[14px]` | `text-sm` | Identical to text-sm (14px). 1:1 replacement. | 1 | Regex: `s/text-\[14px\]/text-sm/g` |
| `text-[15px]` | `text-base` (16px) OR `text-sm` | Portal header subtitle. Contextual decision — if it is a subtitle under a large title, `text-base` is better. | 2 | Manual — check context |

### Token `text-overline` — definition

```css
/* globals.css — add in @theme inline */
@theme inline {
  --font-size-overline: 0.6875rem;      /* 11px */
  --font-size-overline--line-height: 1rem; /* 16px */
}
```

**Usage:**
```tsx
// Before:
<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">

// After:
<span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
```

### Letter spacing — standardization

Three variants (`tracking-wider`, `tracking-widest`, `tracking-[0.15em]`) used interchangeably with `text-[11px] uppercase`.

| Current | Replace with | Rationale |
|---------|-------------|-----------|
| `tracking-wider` | `tracking-wider` (keep) | Tailwind standard: 0.05em |
| `tracking-widest` | `tracking-wider` | Too wide (0.1em). 0.05em is sufficient. |
| `tracking-[0.15em]` | `tracking-wider` | Arbitrary. Standardize to a single value. |

### Codemod — full script

```bash
#!/bin/bash
# ds-migrate-typography.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Run per-module, then review the diff

set -euo pipefail
MODULE_PATH="$1"  # e.g. packages/core/src/modules/customers

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-typography.sh <module-path>"
  exit 1
fi

echo "=== Typography migration: $MODULE_PATH ==="

# Portable in-place replace using perl (works identically on macOS and Linux)
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

replace 's/text-\[10px\]/text-xs/g'
echo "  text-[10px] → text-xs: done"

replace 's/text-\[11px\]/text-overline/g'
echo "  text-[11px] → text-overline: done"

replace 's/text-\[12px\]/text-xs/g'
echo "  text-[12px] → text-xs: done"

replace 's/text-\[13px\]/text-sm/g'
echo "  text-[13px] → text-sm: done"

replace 's/text-\[14px\]/text-sm/g'
echo "  text-[14px] → text-sm: done"

replace 's/tracking-widest/tracking-wider/g'
echo "  tracking-widest → tracking-wider: done"

replace 's/tracking-\[0\.15em\]/tracking-wider/g'
echo "  tracking-[0.15em] → tracking-wider: done"

echo "=== MANUAL CHECK NEEDED: text-[15px] (2 instances, contextual decision) ==="
rg 'text-\[15px\]' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

---

## J.2 Color Mapping (Semantic)

### Error colors

| Current | Occurrences | Replace with | Replacement type | Notes |
|---------|-------------|-------------|-----------------|-------|
| `text-red-600` | 107 | `text-status-error-text` | Regex 1:1 | Primarily error messages, required indicators |
| `text-red-700` | 19 | `text-status-error-text` | Regex 1:1 | Error text in darker context |
| `text-red-800` | 26 | `text-status-error-text` | Regex 1:1 | Error text on light background (Notice) |
| `text-red-500` | 6 | `text-status-error-icon` | Regex 1:1 | Error icons |
| `text-red-900` | 1 | `text-status-error-text` | Regex 1:1 | |
| `bg-red-50` | 24 | `bg-status-error-bg` | Regex 1:1 | Error background |
| `bg-red-100` | 14 | `bg-status-error-bg` | Regex 1:1 | Slightly more intense bg — same token |
| `bg-red-600` | 1 | `bg-destructive` | Manual | Solid error button bg — use existing `destructive` |
| `border-red-200` | ~5 | `border-status-error-border` | Regex 1:1 | Error border |
| `border-red-500` | ~5 | `border-status-error-border` | Regex 1:1 | More intense error border |
| `text-destructive` | (keep) | — | Do not change | Already a token — correct usage |

**Note:** `text-red-600` used as a required indicator in CrudForm FieldControl (line 3418) is an internal change in `packages/ui/src/backend/CrudForm.tsx`. One PR, high impact.

### Success colors

| Current | Occurrences | Replace with | Replacement type |
|---------|-------------|-------------|-----------------|
| `text-green-600` | 18 | `text-status-success-text` | Regex 1:1 |
| `text-green-700` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-green-800` | 26 | `text-status-success-text` | Regex 1:1 |
| `text-green-500` | 1 | `text-status-success-icon` | Regex 1:1 |
| `bg-green-100` | 26 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-50` | 4 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-200` | 1 | `bg-status-success-bg` | Manual — check intensity |
| `border-green-*` | ~5 | `border-status-success-border` | Regex 1:1 |
| `text-emerald-600` | 4 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-700` | 6 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-800` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-900` | 3 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-300` | 1 | `text-status-success-icon` | Manual — dark context? |
| `bg-emerald-100` | 2 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-50` | 5 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-500` | 4 | `bg-status-success-icon` | Manual — solid bg? Perhaps `bg-status-success-text` |
| `bg-emerald-600` | 1 | `bg-status-success-icon` | Manual |
| `border-emerald-*` | ~5 | `border-status-success-border` | Regex 1:1 |

### Warning colors

| Current | Occurrences | Replace with | Replacement type |
|---------|-------------|-------------|-----------------|
| `text-amber-500` | ~10 | `text-status-warning-icon` | Regex 1:1 |
| `text-amber-800` | ~5 | `text-status-warning-text` | Regex 1:1 |
| `text-amber-950` | ~2 | `text-status-warning-text` | Regex 1:1 |
| `bg-amber-50` | ~5 | `bg-status-warning-bg` | Regex 1:1 |
| `bg-amber-400/10` | ~2 | `bg-status-warning-bg` | Regex 1:1 |
| `border-amber-200` | ~3 | `border-status-warning-border` | Regex 1:1 |
| `border-amber-500/30` | ~2 | `border-status-warning-border` | Regex 1:1 |

### Info colors

| Current | Occurrences | Replace with | Replacement type |
|---------|-------------|-------------|-----------------|
| `text-blue-600` | 27 | `text-status-info-text` | Regex 1:1 |
| `text-blue-800` | 25 | `text-status-info-text` | Regex 1:1 |
| `text-blue-700` | 8 | `text-status-info-text` | Regex 1:1 |
| `text-blue-900` | 9 | `text-status-info-text` | Regex 1:1 |
| `text-blue-500` | ~5 | `text-status-info-icon` | Regex 1:1 |
| `bg-blue-50` | 24 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-100` | 19 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-600` | 4 | `bg-status-info-icon` | Manual — solid bg for active state? |
| `border-blue-200` | ~3 | `border-status-info-border` | Regex 1:1 |
| `border-blue-500` | ~2 | `border-status-info-border` | Regex 1:1 |
| `border-sky-600/30` | ~2 | `border-status-info-border` | Regex 1:1 |
| `bg-sky-500/10` | ~2 | `bg-status-info-bg` | Regex 1:1 |
| `text-sky-900` | ~2 | `text-status-info-text` | Regex 1:1 |

### Codemod — full script

```bash
#!/bin/bash
# ds-migrate-colors.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Run per-module, then review the diff

set -euo pipefail
MODULE_PATH="$1"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-colors.sh <module-path>"
  exit 1
fi

echo "=== Color migration: $MODULE_PATH ==="

# Portable in-place replace using perl
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

# ═══ ERROR ═══
for shade in 600 700 800 900; do
  replace "s/text-red-$shade/text-status-error-text/g"
done
replace 's/text-red-500/text-status-error-icon/g'
for shade in 50 100; do
  replace "s/bg-red-$shade/bg-status-error-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-red-$shade/border-status-error-border/g"
done

# ═══ SUCCESS (green) ═══
for shade in 500 600 700 800; do
  replace "s/text-green-$shade/text-status-success-text/g"
done
for shade in 50 100 200; do
  replace "s/bg-green-$shade/bg-status-success-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-green-$shade/border-status-success-border/g"
done

# ═══ SUCCESS (emerald) ═══
for shade in 300 600 700 800 900; do
  replace "s/text-emerald-$shade/text-status-success-text/g"
done
for shade in 50 100; do
  replace "s/bg-emerald-$shade/bg-status-success-bg/g"
done
for shade in 200 300; do
  replace "s/border-emerald-$shade/border-status-success-border/g"
done

# ═══ WARNING (amber) ═══
for shade in 500 800 950; do
  replace "s/text-amber-$shade/text-status-warning-text/g"
done
replace "s/bg-amber-50/bg-status-warning-bg/g"
for shade in 200 500; do
  replace "s/border-amber-$shade/border-status-warning-border/g"
done

# ═══ INFO (blue) ═══
for shade in 600 700 800 900; do
  replace "s/text-blue-$shade/text-status-info-text/g"
done
replace 's/text-blue-500/text-status-info-icon/g'
for shade in 50 100; do
  replace "s/bg-blue-$shade/bg-status-info-bg/g"
done
for shade in 200 500; do
  replace "s/border-blue-$shade/border-status-info-border/g"
done

# ═══ INFO (sky — used in Alert component) ═══
replace 's/text-sky-900/text-status-info-text/g'
replace 's/border-sky-600\/30/border-status-info-border/g'
replace 's/bg-sky-500\/10/bg-status-info-bg/g'

echo "=== MANUAL REVIEW NEEDED ==="
echo "  Check: bg-red-600, bg-emerald-500, bg-emerald-600, bg-blue-600"
echo "  These are solid backgrounds — may need different token (icon/emphasis)"
rg 'bg-red-600|bg-emerald-[56]00|bg-blue-600' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

### Replacement in Alert component (packages/ui/src/primitives/alert.tsx)

**Current CVA variants → new:**

```typescript
// BEFORE:
destructive: 'border-destructive/60 bg-destructive/10 text-destructive [&_svg]:text-destructive',
success:     'border-emerald-600/30 bg-emerald-500/10 text-emerald-900 [&_svg]:text-emerald-600',
warning:     'border-amber-500/30 bg-amber-400/10 text-amber-950 [&_svg]:text-amber-600',
info:        'border-sky-600/30 bg-sky-500/10 text-sky-900 [&_svg]:text-sky-600',

// AFTER:
destructive: 'border-status-error-border bg-status-error-bg text-status-error-text [&_svg]:text-status-error-icon',
success:     'border-status-success-border bg-status-success-bg text-status-success-text [&_svg]:text-status-success-icon',
warning:     'border-status-warning-border bg-status-warning-bg text-status-warning-text [&_svg]:text-status-warning-icon',
info:        'border-status-info-border bg-status-info-bg text-status-info-text [&_svg]:text-status-info-icon',
```

### Replacement in Notice component (packages/ui/src/primitives/Notice.tsx)

```typescript
// BEFORE:
error:   { border: 'border-red-200',   bg: 'bg-red-50',   text: 'text-red-800',   iconBorder: 'border-red-500' }
warning: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', iconBorder: 'border-amber-500' }
info:    { border: 'border-blue-200',  bg: 'bg-blue-50',  text: 'text-blue-900',  iconBorder: 'border-blue-500' }

// AFTER (if keeping Notice with deprecation warning):
error:   { border: 'border-status-error-border',   bg: 'bg-status-error-bg',   text: 'text-status-error-text',   iconBorder: 'border-status-error-icon' }
warning: { border: 'border-status-warning-border', bg: 'bg-status-warning-bg', text: 'text-status-warning-text', iconBorder: 'border-status-warning-icon' }
info:    { border: 'border-status-info-border',    bg: 'bg-status-info-bg',    text: 'text-status-info-text',    iconBorder: 'border-status-info-icon' }
```

### Replacement in FlashMessages (packages/ui/src/backend/FlashMessages.tsx)

```typescript
// BEFORE:
const kindColors: Record<FlashKind, string> = {
  success: 'emerald-600',
  error:   'red-600',
  warning: 'amber-500',
  info:    'blue-600',
}

// AFTER:
const kindColors: Record<FlashKind, string> = {
  success: 'status-success-icon',
  error:   'status-error-icon',
  warning: 'status-warning-icon',
  info:    'status-info-icon',
}
```

### Replacement in Notifications (packages/ui/src/backend/notifications/)

```typescript
// BEFORE:
const severityColors = {
  info:    'text-blue-500',
  warning: 'text-amber-500',
  success: 'text-green-500',
  error:   'text-destructive',
}

// AFTER:
const severityColors = {
  info:    'text-status-info-icon',
  warning: 'text-status-warning-icon',
  success: 'text-status-success-icon',
  error:   'text-status-error-icon',
}
```

---

## J.3 Component Mapping (Notice → Alert)

### Prop-level mapping

| Notice usage | Alert equivalent | Notes |
|-------------|-----------------|-------|
| `<Notice variant="error">` | `<Alert variant="destructive">` | Name changed to "destructive" — consistent with Button |
| `<Notice variant="info">` | `<Alert variant="info">` | No change |
| `<Notice variant="warning">` | `<Alert variant="warning">` | No change |
| `title="Title"` | `<AlertTitle>Title</AlertTitle>` | Composition pattern instead of prop |
| `message="Content"` | `<AlertDescription>Content</AlertDescription>` | Composition pattern instead of prop |
| `action={<Button>Retry</Button>}` | `<AlertAction><Button>Retry</Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Retained — less padding, no icon |
| `children` | `children` (inside Alert) | Retained |
| `className="..."` | `className="..."` | Retained |

### ErrorNotice mapping

| ErrorNotice usage | Alert equivalent |
|-------------------|-----------------|
| `<ErrorNotice />` (no props) | `<Alert variant="destructive"><AlertTitle>{t('ui.errors.defaultTitle')}</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" message="Y" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` |
| `<ErrorNotice action={btn} />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...<AlertAction>{btn}</AlertAction></AlertDescription></Alert>` |

### File-by-file migration plan

| # | File | Current | Replace with | Complexity |
|---|------|---------|-------------|------------|
| 1 | `portal/signup/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive"><AlertDescription>{...}</AlertDescription></Alert>` | Low |
| 2 | `portal/page.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Low |
| 3 | `portal/login/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive">...` | Low |
| 4 | `auth/frontend/login.tsx` | `<Notice variant="error" ...>` + custom error banners | `<Alert variant="destructive">...` + migrate hardcoded banners | **Medium** — also has manually styled banners |
| 5 | `audit_logs/AuditLogsActions.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Low |
| 6 | `data_sync/backend/.../page.tsx` | `<Notice variant="warning" ...>` | `<Alert variant="warning">...` | Low |
| 7 | `data_sync/.../IntegrationScheduleTab.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Low |
| 8 | `customers/deals/pipeline/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Low |
| 9 | `entities/user/[entityId]/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Low |

**Estimated effort:** 6 files → 15 min each = 1.5h. 2 files need more attention (auth login, data_sync page) = +1h. **Total: ~2.5h.**

---

## J.4 Hackathon operation order

**Timing:** FRI 04/11/2026 9:00 – SAT 04/12/2026 11:00 (~13h work + ~5h buffer)

Synchronized with section B. Detailed step-by-step:

```
FRIDAY 9:00–12:00 (BLOCK 1 — Foundations):
  1. Add 20+20 CSS custom properties (flat tokens, light + dark) to globals.css
  2. Add @theme inline mappings (--color-status-*-* → var(--status-*-*))
  3. Add text-overline token (--font-size-overline: 0.6875rem)
  4. Verify contrast in Chrome DevTools (light + dark) — 5 statuses × 2 modes
  5. Document typography scale + spacing guidelines
  6. yarn lint && yarn typecheck
  → Commit: "feat(ds): add semantic status tokens and text-overline"

FRIDAY 13:00–17:00 (BLOCK 2 — Primitives migration):
  7. Replace Alert CVA variants with flat semantic tokens (alert.tsx — 4 lines)
  8. Replace Notice colors with flat tokens + add deprecation (Notice.tsx)
  9. Replace FlashMessages colors (FlashMessages.tsx)
  10. Replace Notification severity colors
  11. Add Badge status variants: success, warning, info (badge.tsx)
  12. Migrate CrudForm FieldControl colors (text-red-600 → text-destructive)
  13. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate all primitives to semantic status tokens"

FRIDAY 18:00–20:00 (BLOCK 3 — New components):
  14. Create FormField (packages/ui/src/primitives/form-field.tsx) with labelVariant
  15. Create StatusBadge (packages/ui/src/primitives/status-badge.tsx) — renders Badge
  16. Stretch: Section/SectionHeader (packages/ui/src/backend/Section.tsx)
  17. yarn lint && yarn typecheck
  → Commit: "feat(ds): add FormField, StatusBadge components"

FRIDAY 20:00–21:00: BREAK / BUFFER

FRIDAY 21:00–22:00 (BLOCK 4 — Documentation):
  18. Write Design Principles — abbreviated version for README
  19. Write PR Review Checklist
  20. Define z-index scale + border-radius guidelines
  → Commit: "docs(ds): add principles, PR review checklist, guidelines"

SATURDAY 8:00–10:00 (BLOCK 5 — Customers migration):
  21. Run ds-migrate-colors.sh on packages/core/src/modules/customers/
  22. Run ds-migrate-typography.sh on the same module
  23. Manual review + fix edge cases + screenshots before/after
  24. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate customers module to DS tokens"

SATURDAY 10:00–11:00 (BLOCK 6 — Wrap-up):
  25. Update AGENTS.md with DS rules
  26. Update PR template with DS compliance checkboxes
  27. Run ds-health-check.sh — save baseline to .ai/reports/
  28. Final yarn lint && yarn typecheck
  → Commit: "docs(ds): update AGENTS.md, PR template, baseline report"
```

**Buffer:** ~5h for edge cases, Section component (if it did not fit in B3), dark mode fine-tuning.
**Cut lines:** See section B.1 — MUST HAVE is Blocks 1+2 (8h).

---

## See also

- [Token Values](./token-values.md) — target token values
- [Enforcement](./enforcement.md) — migration enforcement plan
- [Foundations](./foundations.md) — typography and color scales
- [Risk Analysis](./risk-analysis.md) — migration-related risks
