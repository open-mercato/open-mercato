# Design System v0 — Usage Guide

How to use the DS v0 components, tokens, and tooling in Open Mercato.

---

## 1. Semantic Status Tokens

### What changed
Instead of hardcoded Tailwind colors (`text-red-600`, `bg-green-100`), use semantic tokens that automatically handle dark mode.

### Token structure
```
{property}-status-{status}-{role}
```
- **property**: `text`, `bg`, `border`
- **status**: `error`, `success`, `warning`, `info`, `neutral`
- **role**: `bg`, `text`, `border`, `icon`

### Usage examples

```tsx
// BEFORE (broken dark mode, inconsistent)
<span className="text-red-600 dark:text-red-400">Error</span>
<div className="bg-green-50 dark:bg-green-950/20">Success</div>
<div className="border-amber-300">Warning</div>

// AFTER (dark mode automatic, consistent)
<span className="text-status-error-text">Error</span>
<div className="bg-status-success-bg">Success</div>
<div className="border-status-warning-border">Warning</div>
```

### Full token list

| Token | Light | Dark | When to use |
|-------|-------|------|-------------|
| `text-status-error-text` | dark red | light red | Error messages, validation |
| `text-status-error-icon` | medium red | light red | Error icons |
| `bg-status-error-bg` | pale red | dark red | Error backgrounds |
| `border-status-error-border` | red border | dark red border | Error borders |
| `text-status-success-text` | dark green | light green | Success messages |
| `text-status-success-icon` | medium green | light green | Success icons |
| `bg-status-success-bg` | pale green | dark green | Success backgrounds |
| `border-status-success-border` | green border | dark green border | Success borders |
| `text-status-warning-text` | dark amber | light amber | Warning messages |
| `text-status-warning-icon` | medium amber | light amber | Warning icons |
| `bg-status-warning-bg` | pale amber | dark amber | Warning backgrounds |
| `border-status-warning-border` | amber border | dark amber border | Warning borders |
| `text-status-info-text` | dark blue | light blue | Info messages |
| `text-status-info-icon` | medium blue | light blue | Info icons |
| `bg-status-info-bg` | pale blue | dark blue | Info backgrounds |
| `border-status-info-border` | blue border | dark blue border | Info borders |
| `text-status-neutral-text` | gray | light gray | Neutral/default states |
| `bg-status-neutral-bg` | pale gray | dark gray | Neutral backgrounds |
| `border-status-neutral-border` | gray border | dark gray border | Neutral borders |

### Opacity support
Tokens work with Tailwind opacity modifiers:
```tsx
<div className="bg-status-warning-bg/50">Semi-transparent warning</div>
```

### What NOT to migrate
- Decorative colors (brand, charts, gradients) — keep as-is
- `text-destructive`, `bg-destructive` — already semantic, keep
- Non-status colors (`text-muted-foreground`, `bg-card`) — not in scope

---

## 2. Typography Scale

### Rule
Never use arbitrary text sizes (`text-[11px]`, `text-[13px]`). Use the Tailwind scale:

| Arbitrary | Replace with | Size |
|-----------|-------------|------|
| `text-[10px]` | `text-xs` | 12px |
| `text-[11px]` | `text-overline` | 11px (custom token) |
| `text-[12px]` | `text-xs` | 12px |
| `text-[13px]` | `text-sm` | 14px |
| `text-[14px]` | `text-sm` | 14px |
| `text-[15px]` | `text-base` | 16px (manual review) |

### `text-overline` usage
For 11px uppercase section labels:
```tsx
<span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
  SECTION LABEL
</span>
```

### Typography hierarchy

| Role | Tailwind | When to use |
|------|----------|-------------|
| Page title | `text-2xl font-bold tracking-tight` | One per page |
| Section title | `text-xl font-semibold` | Major sections |
| Subsection | `text-sm font-semibold` | Card titles, detail sections |
| Body | `text-sm` | Default body text |
| Caption | `text-xs text-muted-foreground` | Timestamps, secondary info |
| Label | `text-sm font-medium` | Form labels |
| Overline | `text-overline font-semibold uppercase tracking-wider` | Category tags, section labels |

---

## 3. New Components

### StatusBadge

Display entity status with consistent visual mapping.

```tsx
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'

// 1. Define a status map for your entity
const orderStatusMap: StatusMap<'draft' | 'confirmed' | 'shipped' | 'cancelled'> = {
  draft: 'neutral',
  confirmed: 'info',
  shipped: 'success',
  cancelled: 'error',
}

// 2. Use in your component
<StatusBadge variant={orderStatusMap[order.status]} dot>
  {order.status}
</StatusBadge>
```

Variants: `error`, `success`, `warning`, `info`, `neutral`

### FormField

Wrap standalone form inputs with label + error display. Use in portal pages, auth forms, custom pages. Do NOT use inside CrudForm (it handles fields internally).

```tsx
import { FormField } from '@open-mercato/ui/primitives/form-field'

<FormField label="Email" required error={errors.email}>
  <Input
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
</FormField>
```

Props:
- `label` — field label text
- `description` — help text below the field
- `error` — error message string (shows in red)
- `required` — adds asterisk to label
- `id` — links label to input for accessibility

### SectionHeader

Section title with optional count badge and action button.

```tsx
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'

<SectionHeader
  title="Line Items"
  count={items.length}
  action={{ label: 'Add Item', onClick: handleAdd }}
/>
```

### CollapsibleSection

```tsx
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'

<CollapsibleSection title="Advanced Settings" defaultOpen={false}>
  <p>Content here</p>
</CollapsibleSection>
```

---

## 4. Alert Variants

Alert now supports status variants:

```tsx
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'

<Alert variant="destructive">  {/* error */}
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>

<Alert variant="success">
  <AlertTitle>Saved</AlertTitle>
  <AlertDescription>Changes applied.</AlertDescription>
</Alert>

<Alert variant="warning">
  <AlertTitle>Attention</AlertTitle>
  <AlertDescription>Review before proceeding.</AlertDescription>
</Alert>

<Alert variant="info">
  <AlertTitle>Note</AlertTitle>
  <AlertDescription>New feature available.</AlertDescription>
</Alert>
```

Use `Alert` instead of deprecated `Notice`.

---

## 5. DS Guardian — AI Enforcement Skill

DS Guardian is an agentic skill that Claude Code uses automatically when working on UI code. You can also invoke it directly.

### Slash commands

| Command | What it does |
|---------|-------------|
| `analyze the [module] module for DS violations` | Scans for hardcoded colors, arbitrary sizes, deprecated components, missing aria-labels |
| `migrate [module] to DS` | Full workflow: analyze, plan, confirm, migrate, review, report |
| `DS health` / `DS report` | Runs health check, shows metrics with delta vs baseline |
| `DS review` | Reviews current file/diff against DS rules, gives score 0-10 |
| `scaffold a list page for [entity]` | Generates a DS-compliant page from templates |

### Example workflows

**Migrate a module:**
```
> analyze the workflows module for DS violations
> migrate workflows to DS
```

**Check project health:**
```
> DS health
```

**Review before PR:**
```
> DS review my changes
```

### What DS Guardian checks
1. Hardcoded status colors (`text-red-*`, `bg-green-*`, `text-amber-*`, `bg-blue-*`)
2. Arbitrary text sizes (`text-[11px]`, `text-[13px]`)
3. Deprecated `Notice`/`ErrorNotice` imports
4. Inline `<svg>` (should use lucide-react)
5. Missing `aria-label` on icon-only buttons
6. Missing `EmptyState` on list pages
7. Missing `LoadingMessage` on async pages
8. Raw `fetch()` instead of `apiCall`

---

## 6. Health Check Script

Run manually to see current DS metrics:

```bash
bash .ai/scripts/ds-health-check.sh
```

Output saved to `.ai/reports/ds-health-YYYY-MM-DD.txt`. Automatically compares with the previous report to show delta.

### Metrics tracked

| Metric | Target | Description |
|--------|--------|-------------|
| Hardcoded status colors | 0 | `text-red-*`, `bg-green-*`, etc. in .ts/.tsx files |
| Arbitrary text sizes | 1 | `text-[Npx]` (1 allowed: `text-[9px]` for notification badge) |
| Notice imports | 0 | Deprecated `Notice` component usage |
| ErrorNotice imports | 0 | Deprecated `ErrorNotice` component usage |
| Inline SVG | 0 | `<svg>` in .tsx files (use lucide-react) |
| Raw fetch files | 0 | `fetch()` in backend pages (use apiCall) |
| Empty state coverage | 100% | Pages with EmptyState / total list pages |
| Loading state coverage | 100% | Pages with LoadingMessage / total pages |
| Semantic token usages | growing | Count of `status-error-*`, `status-success-*` etc. |

---

## 7. Migration Scripts

Two codemod scripts for bulk migration:

```bash
# Migrate hardcoded colors in a module
bash .ai/skills/ds-guardian/scripts/ds-migrate-colors.sh packages/core/src/modules/MODULE_NAME/

# Migrate arbitrary text sizes in a module
bash .ai/skills/ds-guardian/scripts/ds-migrate-typography.sh packages/core/src/modules/MODULE_NAME/

# Review the diff
git diff packages/core/src/modules/MODULE_NAME/
```

Always review the diff after running scripts — edge cases (decorative colors, opacity modifiers, conditional expressions) need manual attention.

---

## 8. Boy Scout Rule

When editing any file that contains DS violations, you MUST fix at minimum the lines you touched:

- If you edit a line with `text-red-600` for a status, change it to `text-status-error-text`
- If you edit a line with `text-[11px]`, change it to `text-overline`
- You don't have to fix the entire file, but fix what you touch

This is enforced via AGENTS.md rules and PR template checklist.

---

## 9. PR Compliance Checklist

Every PR template now includes a Design System Compliance section:

- [ ] No hardcoded status colors (`text-red-*`, `bg-green-*`, etc.)
- [ ] No arbitrary text sizes (`text-[11px]`)
- [ ] Empty state handled where applicable
- [ ] Loading state handled where applicable
- [ ] Icon-only buttons have `aria-label`
- [ ] Uses DS components (`Alert`, `StatusBadge`, `FormField`) instead of ad-hoc markup

---

## 10. Quick Reference Card

### Imports

```tsx
// Status display
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'

// Form fields (standalone forms only)
import { FormField } from '@open-mercato/ui/primitives/form-field'

// Section headers
import { SectionHeader, CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'

// Alerts (replacing Notice)
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'

// Icons (always lucide-react)
import { Check, X, AlertTriangle, Info } from 'lucide-react'
```

### Decision table

| I need to... | Use |
|---|---|
| Show entity status | `<StatusBadge variant={map[status]} dot>` |
| Show error/success/warning inline | `<Alert variant="destructive\|success\|warning\|info">` |
| Show toast | `flash('message', 'success')` |
| Wrap form input with label | `<FormField label="..." error={...}>` |
| Section header with count | `<SectionHeader title="..." count={n}>` |
| Red text for error | `text-status-error-text` (not `text-red-600`) |
| Green background for success | `bg-status-success-bg` (not `bg-green-50`) |
| 11px uppercase label | `text-overline font-semibold uppercase tracking-wider` |
| Icon | `<IconName className="size-4" />` from lucide-react |
| Icon-only button | Add `aria-label="description"` |

### Reference module
When building new UI, use the **customers module** as reference implementation:
- List: `packages/core/src/modules/customers/backend/customers/people/page.tsx`
- Detail: `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx`
- Status mapping: `packages/core/src/modules/customers/components/formConfig.tsx`
