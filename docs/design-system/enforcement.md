# E. Enforcement & Migration Plan

> Enforcement plan: ESLint rules, codemod scripts, migration playbook for hardcoded colors, typography, icons, components, and a11y.

---

## E.1 Hardcoded Colors (372 occurrences)

### ESLint Rule

Add a custom rule to `eslint.config.mjs` blocking semantic color classes in new files:

```javascript
// eslint-plugin-open-mercato/no-hardcoded-status-colors.js
// Blocks: text-red-*, bg-red-*, border-red-*, text-green-*, bg-green-*,
//         text-emerald-*, bg-emerald-*, text-blue-* (status contexts),
//         text-amber-*, bg-amber-*
// Allowed: text-destructive, bg-destructive/*, text-status-*, bg-status-*

const BLOCKED_PATTERNS = [
  /\btext-red-\d+/,
  /\bbg-red-\d+/,
  /\bborder-red-\d+/,
  /\btext-green-\d+/,
  /\bbg-green-\d+/,
  /\bborder-green-\d+/,
  /\btext-emerald-\d+/,
  /\bbg-emerald-\d+/,
  /\bborder-emerald-\d+/,
  /\btext-amber-\d+/,
  /\bbg-amber-\d+/,
  /\bborder-amber-\d+/,
  /\btext-blue-\d+/,   // only in status contexts
  /\bbg-blue-\d+/,
  /\bborder-blue-\d+/,
]
```

**Strategy:** Enable as `warn` from day 1 (does not block build). After 2 sprints, switch to `error` for new files. After 4 sprints — `error` globally.

### Codemod / regex strategy

**Phase 1 — Error states (`text-red-600` → semantic token):**

```bash
# Find all occurrences
rg 'text-red-600' --type tsx -l
# 107 occurrences — most are error messages and required indicators

# Replace in CrudForm FieldControl (internal):
# text-red-600 → text-destructive
# Applies to: required indicator, error message

# Mapping:
# text-red-600  → text-destructive
# text-red-700  → text-destructive
# text-red-800  → text-destructive (darker context)
# bg-red-50     → bg-destructive/5
# bg-red-100    → bg-destructive/10
# border-red-200 → border-destructive/20
# border-red-500 → border-destructive/60
```

**Phase 2 — Success states:**

```bash
# Mapping:
# text-green-600  → text-status-success
# text-green-800  → text-status-success
# bg-green-100    → bg-status-success-bg
# bg-green-50     → bg-status-success/5
# text-emerald-*  → text-status-success (interchangeable)
# bg-emerald-*    → bg-status-success/*
```

**Phase 3 — Warning/Info states:**

```bash
# Mapping:
# text-amber-500  → text-status-warning
# text-amber-800  → text-status-warning
# bg-amber-50     → bg-status-warning/5
# text-blue-600   → text-status-info
# text-blue-800   → text-status-info
# bg-blue-50      → bg-status-info/5
# bg-blue-100     → bg-status-info/10
```

### Migration strategy: per-module, not an atomic PR

**Module order:**

| # | Module | Reason | Effort | Files |
|---|--------|--------|--------|-------|
| 1 | `packages/ui/src/primitives/` | Foundation — Notice, Alert, Badge | Low | 4 files |
| 2 | `packages/ui/src/backend/` | CrudForm FieldControl, FlashMessages, EmptyState | Medium | ~10 files |
| 3 | `packages/core/src/modules/customers/` | Most complex, reference module | Medium | ~15 files |
| 4 | `packages/core/src/modules/auth/` | Frontend login with hardcoded alert colors | Low | 3 files |
| 5 | `packages/core/src/modules/sales/` | Status badges on documents | Medium | ~10 files |
| 6 | `packages/core/src/modules/portal/` | Frontend pages with hardcoded colors | Low | 4 files |
| 7 | Remaining modules | Catalog-style migration | Medium | ~40 files |

**One PR per module.** Each PR:
- Replaces hardcoded colors with semantic tokens
- Adds a `// DS-MIGRATED` comment on the last line of the file (for tracking)
- Visually tested (screenshot before/after)

---

## E.2 Arbitrary Text Sizes (61 occurrences)

### Mapping table

| Old | New | Rationale |
|-----|-----|-----------|
| `text-[9px]` | `text-[9px]` (exception) | Notification badge count — too small for the standard scale, keep as-is |
| `text-[10px]` | `text-xs` (12px) | Round up, more readable |
| `text-[11px]` | `text-xs` (12px) or new `text-overline` | 33 occurrences — this is a de facto "overline" pattern |
| `text-[12px]` | `text-xs` | Identical to text-xs |
| `text-[13px]` | `text-sm` (14px) | Round up by 1px |
| `text-[14px]` | `text-sm` | Identical to text-sm |
| `text-[15px]` | `text-base` (16px) or `text-sm` | Depends on context |

**Option: add `text-overline` to the Tailwind config:**

```css
/* globals.css - in the @theme section */
--font-size-overline: 0.6875rem; /* 11px */
--font-size-overline--line-height: 1rem;
```

This allows replacing `text-[11px]` with `text-overline` without an arbitrary value.

### Lint rule

```javascript
// Blocks text-[Npx] in new files
// Exceptions: text-[9px] (badge count)
const BLOCKED = /\btext-\[\d+px\]/
const ALLOWED = ['text-[9px]']
```

---

## E.3 Notice → Alert Migration

### Scope

- **Notice**: 7 files
- **Alert**: 18 files
- **ErrorNotice**: 2 files
- **Total to migrate**: 9 files (Notice + ErrorNotice)

### Strategy: Adapter → Hard Replace

**Step 1 (hackathon):** Deprecation notice in Notice.tsx

```typescript
// packages/ui/src/primitives/Notice.tsx
/**
 * @deprecated Use <Alert variant="error|warning|info"> instead.
 * Will be removed in v0.6.0.
 * Migration: Notice variant="error" → Alert variant="destructive"
 *            Notice variant="warning" → Alert variant="warning"
 *            Notice variant="info" → Alert variant="info"
 */
export function Notice(props: NoticeProps) {
  if (process.env.NODE_ENV === 'development') {
    console.warn('[DS] Notice is deprecated. Use Alert instead. See migration guide.')
  }
  // ... existing implementation
}
```

**Step 2 (week after hackathon):** Migrate 7 files from Notice → Alert

| Old (Notice) | New (Alert) |
|--------------|-------------|
| `<Notice variant="error" title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice variant="warning" title="..." />` | `<Alert variant="warning"><AlertTitle>...</AlertTitle></Alert>` |
| `<Notice variant="info" message="..." />` | `<Alert variant="info"><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice compact message="..." />` | `<Alert variant="info" compact><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice action={<Button>...</Button>} />` | `<Alert variant="info"><AlertDescription>...<AlertAction>...</AlertAction></AlertDescription></Alert>` |
| `<ErrorNotice title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |

**Step 3 (v0.6.0):** Remove Notice.tsx and ErrorNotice.tsx

### Files to migrate (specific)

**Notice (7 files):**
1. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/signup/page.tsx`
2. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/page.tsx`
3. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/login/page.tsx`
4. `packages/core/src/modules/auth/frontend/login.tsx`
5. `packages/core/src/modules/audit_logs/components/AuditLogsActions.tsx`
6. `packages/core/src/modules/data_sync/backend/data-sync/page.tsx`
7. `packages/core/src/modules/data_sync/components/IntegrationScheduleTab.tsx`

**ErrorNotice (2 files):**
8. `packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx`
9. `packages/core/src/modules/entities/backend/entities/user/[entityId]/page.tsx`

---

## E.4 Icon System (inline SVG → lucide-react)

### Scope: 14 files with inline `<svg>`

**Custom SVG → lucide equivalent mapping:**

| File | Custom SVG | Lucide equivalent |
|------|-----------|-------------------|
| Portal `signup/page.tsx` | CheckIcon, XIcon | `Check`, `X` |
| Portal `dashboard/page.tsx` | BellIcon, WidgetIcon | `Bell`, `LayoutGrid` |
| Portal `page.tsx` | ShoppingBagIcon, UserIcon, ShieldIcon | `ShoppingBag`, `User`, `Shield` |
| `auth/lib/profile-sections.tsx` | Custom icons | Check per-icon |
| `workflows/checkout-demo/page.tsx` | CheckIcon, decorative SVG | `Check`, `CircleCheck` |
| `workflows/definitions/[id]/page.tsx` | Flow icons | `Workflow`, `GitBranch` |
| `workflows/EdgeEditDialog.tsx` | Edge icons | `ArrowRight`, `Cable` |
| `workflows/NodeEditDialog.tsx` | Node icons | `Square`, `Circle` |
| `workflows/BusinessRulesSelector.tsx` | Rule icon | `Scale`, `Gavel` |
| `integrations/.../widget.client.tsx` | External ID icon | `ExternalLink`, `Link2` |
| `staff/team-members/page.tsx` | Team icon | `Users`, `UserPlus` |
| `staff/team-roles/page.tsx` | Role icon | `Shield`, `Key` |

**2 test files** (`__tests__/`) — SVGs in mocks, no migration required.

### Strategy

```bash
# Find all inline SVGs (excluding tests)
rg '<svg' --type tsx -l --glob '!**/__tests__/**' packages/core/src/modules/
# 12 files to migrate (2 test files skipped)
```

Migrate per-file. Each PR replaces inline SVGs with lucide imports.

---

## E.5 PR Template Update

Add to `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
### Design System Compliance
- [ ] No hardcoded status colors (`text-red-*`, `bg-green-*`, etc.) — use semantic tokens
- [ ] No arbitrary text sizes (`text-[Npx]`) — use typography scale
- [ ] Empty state handled for list/data pages
- [ ] Loading state handled for async pages
- [ ] `aria-label` on all icon-only buttons
- [ ] Uses existing DS components (Button, Alert, Badge) — no custom replacements
```

---

## E.6 AGENTS.md Update

Add to the root `AGENTS.md` in the `## Conventions` section or as a new `## Design System Rules` section:

```markdown
## Design System Rules

### Colors
- NEVER use hardcoded Tailwind colors for status semantics (`text-red-*`, `bg-green-*`, etc.)
- USE semantic tokens: `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`
- Status colors: `destructive` (error), `status-success`, `status-warning`, `status-info`, `status-neutral`

### Typography
- NEVER use arbitrary text sizes (`text-[11px]`, `text-[13px]`)
- USE Tailwind scale: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`
- For 11px overline pattern: use `text-overline` (custom utility)

### Feedback
- USE `Alert` for inline messages (NOT `Notice` — deprecated)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list page MUST handle empty state via `<EmptyState>`
- Every async page MUST show loading via `<LoadingMessage>` or `<Spinner>`

### Icons
- USE `lucide-react` for all icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (xs), `size-4` (sm/default), `size-5` (md), `size-6` (lg)

### Components
- USE `Button`/`IconButton` — NEVER raw `<button>`
- USE `apiCall()`/`apiCallOrThrow()` — NEVER raw `fetch()` in backend pages
- USE `StatusBadge` for entity status display — NEVER hardcoded color Badge
- USE `FormField` wrapper for standalone forms — CrudForm handles internally
- USE `SectionHeader` for collapsible detail sections
```

---

## E.7 Boy Scout Rule

**Policy:** Every PR that touches a file with hardcoded status colors MUST migrate at least the affected lines.

**Implementation:**
- Add to the PR review checklist
- Add a comment in AGENTS.md:

```markdown
### Boy Scout Rule (Design System)
When modifying a file that contains hardcoded status colors (text-red-*, bg-green-*, etc.),
you MUST migrate at minimum the lines you touched to semantic tokens.
Optionally migrate the entire file if scope allows.
```

- CI check (optional): a script comparing `git diff --name-only` with the list of files containing hardcoded colors. If a PR touches a file from the list but does not reduce the count — warning.

---

---

## See also

- [Metrics](./metrics.md) — KPIs and ds-health-check.sh script
- [Migration Tables](./migration-tables.md) — color and typography mapping tables
- [Lint Rules](./lint-rules.md) — ESLint v9 flat config rules
- [Token Values](./token-values.md) — OKLCH token values
