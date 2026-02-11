# SPEC-023 — Confirmation Dialog Migration

Replace all `window.confirm()` / `confirm()` calls across the codebase with a styled, accessible, i18n-compatible confirmation dialog component.

## Overview

The codebase currently uses native `window.confirm()` for destructive action confirmations in **68 files** across `packages/ui`, `packages/core`, and `packages/scheduler`. The existing `ConfirmDialog` component in `packages/ui/src/backend/ConfirmDialog.tsx` is a thin wrapper that still delegates to `window.confirm()` internally.

Native `window.confirm()` has significant UX and accessibility limitations:
- Blocks the main thread — the entire page freezes
- Unstyled — cannot match the design system, looks different per browser/OS
- Button labels ("OK"/"Cancel") are in the browser's locale, not the app's — breaks i18n
- No support for `Cmd/Ctrl+Enter` keyboard convention required by AGENTS.md
- No destructive variant styling (red button for delete actions)
- Poor mobile UX — browser dialogs are intrusive on mobile
- Cannot include additional context (icons, descriptions, warnings)

### Goals

1. Provide a styled `ConfirmationDialog` component built on Radix AlertDialog
2. Provide a promise-based `confirmAsync()` helper for easy migration of existing code
3. Migrate all 68 files from `window.confirm()` to the new component
4. Remove the legacy `ConfirmDialog.tsx` wrapper

### Non-Goals

- Replacing other dialog patterns (form dialogs, modals) — only confirmation flows
- Adding complex multi-step confirmation workflows (e.g., "type the name to confirm")

## Architecture

### Component Hierarchy

```
@radix-ui/react-alert-dialog (new dependency)
  └── packages/ui/src/primitives/alert-dialog.tsx        (Radix primitive wrapper)
       └── packages/ui/src/backend/ConfirmationDialog.tsx (styled business component)
            └── packages/ui/src/backend/ConfirmationProvider.tsx (context + confirmAsync)
```

### Two Usage Patterns

**Pattern A — Declarative (new code)**

For new code or cases where the trigger element is inline:

```tsx
import { ConfirmationDialog } from '@open-mercato/ui/backend/ConfirmationDialog'

<ConfirmationDialog
  trigger={<Button variant="destructive">{t('common.delete', 'Delete')}</Button>}
  title={t('customers.confirm.delete.title', 'Delete Customer')}
  description={t('customers.confirm.delete.description', 'This action cannot be undone.')}
  confirmLabel={t('common.delete', 'Delete')}
  variant="destructive"
  onConfirm={handleDelete}
/>
```

**Pattern B — Imperative / Promise-based (migration path)**

For existing code that uses `if (!confirm(...)) return` — mechanical find-replace:

```tsx
import { useConfirmation } from '@open-mercato/ui/backend/ConfirmationProvider'

const { confirmAsync } = useConfirmation()

// Before:
if (!window.confirm(t('scheduler.confirm.delete', 'Are you sure?'))) return

// After:
if (!(await confirmAsync({
  title: t('scheduler.confirm.delete.title', 'Delete Schedule'),
  description: t('scheduler.confirm.delete.description', 'This action cannot be undone.'),
  variant: 'destructive',
}))) return
```

## Data Models

No database entities. This is a pure UI concern.

### TypeScript Types

```typescript
/** Variant controls visual styling of the confirm button */
type ConfirmationVariant = 'default' | 'destructive'

/** Options for the declarative component */
type ConfirmationDialogProps = {
  /** Element that triggers the dialog when clicked */
  trigger: React.ReactNode
  /** Dialog title — MUST use t() for i18n */
  title: string
  /** Optional description below the title */
  description?: string
  /** Label for the confirm button. Defaults to t('ui.confirm.ok', 'Confirm') */
  confirmLabel?: string
  /** Label for the cancel button. Defaults to t('ui.confirm.cancel', 'Cancel') */
  cancelLabel?: string
  /** Visual variant — 'destructive' renders confirm button in red */
  variant?: ConfirmationVariant
  /** Called when user confirms. Dialog closes automatically. */
  onConfirm: () => void | Promise<void>
  /** Called when user cancels. Dialog closes automatically. */
  onCancel?: () => void
  /** Whether the confirm button shows a loading state. Useful for async onConfirm. */
  loading?: boolean
}

/** Options for the imperative confirmAsync() call */
type ConfirmAsyncOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmationVariant
}

/** Context value provided by ConfirmationProvider */
type ConfirmationContextValue = {
  confirmAsync: (options: ConfirmAsyncOptions) => Promise<boolean>
}
```

## API Contracts

No API endpoints. This is a client-side component.

## UI/UX

### Visual Design

The dialog MUST:
- Use the existing design system tokens (colors, typography, spacing)
- Match the visual language of the existing `Dialog` primitive
- Render as a centered modal with backdrop overlay
- Be responsive — bottom sheet on mobile, centered on desktop (matching existing `DialogContent`)

### Layout

```
┌─────────────────────────────────────┐
│  Title                          [X] │
│                                     │
│  Description text explaining        │
│  what will happen.                  │
│                                     │
│              [Cancel]  [Confirm]    │
└─────────────────────────────────────┘
```

- `variant: 'destructive'` → Confirm button uses `variant="destructive"` (red)
- `variant: 'default'` → Confirm button uses `variant="default"`
- Cancel button always uses `variant="outline"`

### Keyboard Shortcuts — MUST

| Key | Action |
|-----|--------|
| `Escape` | Cancel and close (handled by Radix AlertDialog) |
| `Cmd/Ctrl+Enter` | Confirm (custom handler) |
| `Enter` | Confirm when confirm button is focused |
| `Tab` | Navigate between Cancel and Confirm buttons |

### Focus Management

- On open: focus moves to the Cancel button (safe default — prevents accidental confirmation)
- For `variant: 'destructive'`: focus MUST start on Cancel (not Confirm) to prevent accidental deletes
- On close: focus returns to the trigger element

### Accessibility

- Uses Radix AlertDialog which provides `role="alertdialog"`, `aria-modal`, and focus trapping
- Confirm and Cancel buttons have explicit `aria-label` attributes
- Title rendered as `AlertDialogTitle` (accessible name for the dialog)
- Description rendered as `AlertDialogDescription` (accessible description)

## Configuration

### New Dependency

```bash
yarn add @radix-ui/react-alert-dialog
```

Add to `packages/ui/package.json` dependencies.

### Provider Setup

`ConfirmationProvider` MUST be added to the app's root layout, wrapping the page content:

```tsx
// apps/mercato/src/app/layout.tsx (or equivalent root)
import { ConfirmationProvider } from '@open-mercato/ui/backend/ConfirmationProvider'

<ConfirmationProvider>
  {children}
</ConfirmationProvider>
```

## Implementation Plan

### Phase 1 — Component Foundation

1. Add `@radix-ui/react-alert-dialog` dependency to `packages/ui`
2. Create `packages/ui/src/primitives/alert-dialog.tsx` — Radix primitive wrapper (following existing `dialog.tsx` pattern)
3. Create `packages/ui/src/backend/ConfirmationDialog.tsx` — styled component with `variant`, i18n labels, `Cmd+Enter` handler
4. Create `packages/ui/src/backend/ConfirmationProvider.tsx` — React context with `confirmAsync()` implementation
5. Export from `packages/ui` barrel files

### Phase 2 — Provider Integration

1. Add `ConfirmationProvider` to app root layout
2. Verify `confirmAsync()` works in development

### Phase 3 — Migration (by package)

Migrate in order of impact and risk:

| Priority | Package | Files | Notes |
|----------|---------|-------|-------|
| 1 | `packages/ui` | ~5 | Fix the foundation first — `CrudForm.tsx`, `ConfirmDialog.tsx`, `FieldDefinitionsEditor.tsx`, `NotesSection.tsx`, `ActivitiesSection.tsx` |
| 2 | `packages/core/modules/customers` | ~6 | Reference module — establishes the migration pattern |
| 3 | `packages/core/modules/sales` | ~6 | Complex module with document workflows |
| 4 | `packages/core/modules/workflows` | ~8 | Edge/node editors with multiple confirm calls |
| 5 | `packages/core/modules/staff` | ~4 | Teams, roles |
| 6 | `packages/core/modules/auth` | ~2 | Users, roles pages |
| 7 | `packages/core` (remaining) | ~15 | currencies, catalog, directory, configs, etc. |
| 8 | `packages/scheduler` | ~2 | New module — migrate as part of scheduler PR |
| 9 | Cleanup | 1 | Delete legacy `ConfirmDialog.tsx` |

### Phase 4 — Cleanup

1. Remove legacy `packages/ui/src/backend/ConfirmDialog.tsx`
2. Update `packages/ui/AGENTS.md` with new confirmation pattern
3. Add lint rule or AGENTS.md convention to prevent new `window.confirm()` usage

### Migration Pattern

Each file follows the same mechanical transformation:

**Before (inline confirm):**
```tsx
const handleDelete = async (row) => {
  if (!confirm(t('module.confirm.delete', 'Are you sure?'))) return
  await deleteCrud('resource', { id: row.id })
}
```

**After (imperative confirmAsync):**
```tsx
const { confirmAsync } = useConfirmation()

const handleDelete = async (row) => {
  if (!(await confirmAsync({
    title: t('module.confirm.delete.title', 'Delete Item'),
    description: t('module.confirm.delete.description', 'This action cannot be undone.'),
    variant: 'destructive',
    confirmLabel: t('common.delete', 'Delete'),
  }))) return
  await deleteCrud('resource', { id: row.id })
}
```

**Before (ConfirmDialog wrapper):**
```tsx
<ConfirmDialog
  trigger={<Button>Delete</Button>}
  title="Delete?"
  onConfirm={handleDelete}
/>
```

**After (declarative ConfirmationDialog):**
```tsx
<ConfirmationDialog
  trigger={<Button variant="destructive">{t('common.delete', 'Delete')}</Button>}
  title={t('module.confirm.delete.title', 'Delete Item')}
  variant="destructive"
  onConfirm={handleDelete}
/>
```

### i18n Key Convention

New translation keys for confirmation dialogs:

```
<module>.confirm.<action>.title     → "Delete Customer"
<module>.confirm.<action>.description → "This action cannot be undone."
ui.confirm.ok                       → "Confirm" (global default)
ui.confirm.cancel                   → "Cancel" (global default)
common.delete                       → "Delete"
```

## Risks & Impact Review

#### Radix AlertDialog Conflicts with Existing Dialog
- **Scenario**: Both `Dialog` and `AlertDialog` are open simultaneously, causing z-index or focus-trap conflicts
- **Severity**: Low
- **Affected area**: Any page that already has an open Dialog and tries to show a confirmation
- **Mitigation**: Radix handles nested portals and focus traps correctly. AlertDialog renders in its own portal with a higher z-index by default. Test nested dialog scenarios during Phase 1.
- **Residual risk**: Edge cases with triple-nested dialogs — acceptable, unlikely in practice.

#### Provider Missing in App Layout
- **Scenario**: `confirmAsync()` is called but `ConfirmationProvider` is not in the component tree. Throws at runtime.
- **Severity**: High
- **Affected area**: All pages using `confirmAsync()`
- **Mitigation**: Phase 2 adds the provider before any migration begins. Add a clear error message in `useConfirmation()`: `throw new Error('useConfirmation must be used within ConfirmationProvider')`. Unit test the hook without provider to verify the error.
- **Residual risk**: None — provider in root layout covers all routes.

#### Partial Migration — Mixed Patterns
- **Scenario**: During migration, some files use `window.confirm()` and others use `confirmAsync()`. Inconsistent UX.
- **Severity**: Low
- **Affected area**: User experience during migration period
- **Mitigation**: Migrate per-module (not per-file). Each module is fully migrated before moving to the next. Prioritize `packages/ui` first since it's the shared foundation.
- **Residual risk**: Temporary inconsistency between modules — acceptable during migration.

#### Async Confirmation Changes Control Flow
- **Scenario**: `confirmAsync()` returns a Promise, so handlers must be `async`. Existing handlers that aren't `async` need modification.
- **Severity**: Medium
- **Affected area**: ~68 files during migration
- **Mitigation**: Most handlers are already `async` (they call `apiCallOrThrow`, `deleteCrud`, etc.). For the few that aren't, adding `async` is a safe, mechanical change. No behavioral difference.
- **Residual risk**: None.

#### SSR Compatibility
- **Scenario**: `confirmAsync()` or `ConfirmationDialog` used in a server component
- **Severity**: Low
- **Affected area**: SSR rendering
- **Mitigation**: Both components are `"use client"`. The existing `typeof window !== 'undefined' && !window.confirm(...)` pattern already guards against SSR — the new pattern naturally avoids it since dialogs are client-only. The provider renders `null` on the server.
- **Residual risk**: None.

#### Bundle Size Impact
- **Scenario**: Adding `@radix-ui/react-alert-dialog` increases bundle size
- **Severity**: Low
- **Affected area**: Initial page load
- **Mitigation**: `@radix-ui/react-alert-dialog` is ~3KB gzipped. The project already uses `@radix-ui/react-dialog` (same underlying primitives), so most of the code is shared. Net impact is minimal.
- **Residual risk**: Negligible.

## Changelog

### 2026-02-11
- Initial specification
- Identified 68 files using `window.confirm()` across the codebase
- Designed two-pattern approach: declarative `ConfirmationDialog` + imperative `confirmAsync()`
- Defined 4-phase migration plan with per-module ordering
