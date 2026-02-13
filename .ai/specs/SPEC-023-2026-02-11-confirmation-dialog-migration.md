# ConfirmDialog Refactor — Native `<dialog>` + window.confirm Elimination

**Date:** 2026-02-12
**Status:** Draft
**Module:** `ui` (packages/ui)
**Based on:** Adam's spec (architecture, detail level) + Patryk's spec (declarative pattern, loading state, deferred cleanup)

---

## Overview

Replace the current `ConfirmDialog` component (which wraps `window.confirm`) with a modern, accessible, native HTML `<dialog>`-based confirmation dialog. Then refactor all ~68 `window.confirm` call sites across the codebase to use the new component.

**Current state:** `packages/ui/src/backend/ConfirmDialog.tsx` is a thin wrapper that calls `window.confirm()` — a blocking browser dialog with no styling, no branding, and poor UX on mobile. Additionally, ~66 other call sites use `window.confirm()` directly across `packages/ui`, `packages/core`, `packages/scheduler`, and `apps/mercato`.

**Target state:** A single, reusable `<dialog>`-based `ConfirmDialog` component with Tailwind styling, `::backdrop` support, WCAG accessibility, responsive design, and configurable props. Two usage patterns: a **promise-based hook** for easy migration and a **declarative component** for new code. All `window.confirm` usages replaced.

### Non-Goals

- Replacing other dialog patterns (form dialogs, modals) — only confirmation flows
- Adding complex multi-step confirmation workflows (e.g., "type the name to confirm")

---

## Problem Statement

1. **Poor UX**: `window.confirm()` renders an unstyled browser-native dialog that looks different per OS/browser, cannot be customized, and is jarring on mobile.
2. **No branding**: The confirmation dialog does not match the application's design system.
3. **Accessibility gaps**: Browser-native confirm dialogs lack custom ARIA labels, focus management control, and keyboard interaction beyond basic OK/Cancel.
4. **Blocking behavior**: `window.confirm()` is synchronous and blocks the main thread.
5. **Broken i18n**: Button labels ("OK"/"Cancel") render in the browser's locale, not the app's locale.
6. **No keyboard convention**: No support for `Cmd/Ctrl+Enter` keyboard shortcut required by AGENTS.md.
7. **No variant styling**: Cannot visually distinguish destructive actions (delete) from neutral confirmations.
8. **Inconsistency**: 68+ places use `window.confirm` directly with hardcoded strings, bypassing the existing wrapper.

---

## Architecture

### Component Strategy

Use the native HTML `<dialog>` element (not Radix UI AlertDialog) because:

- Built-in modal behavior via `.showModal()` with native focus trapping
- Native `::backdrop` pseudo-element for overlay styling
- Native `Escape` key to close
- Lightweight — zero runtime dependency, zero bundle cost
- Excellent browser support (baseline since March 2022)
- Semantically correct per W3C HTML5 spec
- `role="alertdialog"` provides correct screen reader semantics

The existing Radix UI `Dialog` primitive (`packages/ui/src/primitives/dialog.tsx`) remains unchanged — it serves complex dialogs (forms, metadata editors). `ConfirmDialog` is a simpler, purpose-built component for yes/no confirmations.

### Two Usage Patterns

**Pattern A — Imperative hook (migration path, primary pattern)**

For migrating existing `window.confirm()` call sites. Preserves linear control flow with `await`:

```tsx
const { confirm, ConfirmDialogElement } = useConfirmDialog()

async function handleDelete() {
  const ok = await confirm({
    title: t('customers.people.list.deleteConfirm', undefined, { name }),
    variant: 'destructive',
  })
  if (!ok) return
  deleteCrud('/api/customers/people', row.id)
}

return (
  <>
    {/* ... page content ... */}
    {ConfirmDialogElement}
  </>
)
```

**Pattern B — Declarative component (new code)**

For new code or cases where the trigger element is inline. No hook needed:

```tsx
<ConfirmDialog
  trigger={<Button variant="destructive">{t('common.delete', 'Delete')}</Button>}
  title={t('customers.confirm.delete.title', 'Delete Customer')}
  text={t('customers.confirm.delete.description', 'This action cannot be undone.')}
  variant="destructive"
  onConfirm={handleDelete}
/>
```

### Folder Structure

```
packages/ui/src/backend/confirm-dialog/
  ConfirmDialog.tsx        # Native <dialog> component (controlled + declarative modes)
  useConfirmDialog.tsx     # Promise-based hook
  index.ts                 # Barrel export
```

The old file `packages/ui/src/backend/ConfirmDialog.tsx` is deleted in the final cleanup phase (after all call sites are migrated). The re-export in `packages/ui/src/index.ts` is updated from `'./backend/ConfirmDialog'` to `'./backend/confirm-dialog'`.

---

## Part 1: ConfirmDialog Component

### File Location

**File:** `packages/ui/src/backend/confirm-dialog/ConfirmDialog.tsx` (new file)

### Props Interface

```typescript
export type ConfirmDialogProps = {
  /** Whether the dialog is open (controlled mode — used by useConfirmDialog) */
  open?: boolean;
  /** Callback when open state changes (controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** Callback when user confirms */
  onConfirm: () => void | Promise<void>;
  /** Callback when user cancels (optional, defaults to closing) */
  onCancel?: () => void;
  /** Dialog title. Defaults to i18n key "ui.dialogs.confirm.defaultTitle" ("Are you sure?") */
  title?: string;
  /** Dialog body text / description */
  text?: string;
  /** Confirm button label. Defaults to i18n "ui.dialogs.confirm.confirmText" ("Confirm").
   *  Pass `false` to hide the confirm button entirely. */
  confirmText?: string | false;
  /** Cancel button label. Defaults to i18n "ui.dialogs.confirm.cancelText" ("Cancel").
   *  Pass `false` to hide the cancel button entirely. */
  cancelText?: string | false;
  /** Visual variant — "destructive" renders the confirm button in red */
  variant?: "default" | "destructive";
  /** Whether the confirm button shows a loading spinner.
   *  Useful for async onConfirm handlers (e.g., waiting for API response before closing). */
  loading?: boolean;
  /** Trigger element — when provided, component manages its own open state (declarative mode).
   *  Clicking the trigger opens the dialog. */
  trigger?: React.ReactNode;
};
```

### Implementation Specification

```tsx
"use client";
import * as React from "react";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { Button } from "@open-mercato/ui/primitives/button";
import { cn } from "@open-mercato/shared/lib/utils";
```

**Key implementation details:**

1. **Two modes of operation:**
   - **Controlled mode** (`open` + `onOpenChange` props) — used by `useConfirmDialog` hook. Component does not manage state.
   - **Declarative mode** (`trigger` prop) — component manages its own `open` state internally via `useState`. Clicking `trigger` opens the dialog.
   - If both `trigger` and `open` are provided, `open` takes precedence (controlled wins).

2. **`<dialog>` element** with `ref` — call `dialogRef.current.showModal()` when open becomes `true`, call `dialogRef.current.close()` when open becomes `false`.

3. **`::backdrop` styling** via Tailwind's `backdrop:` modifier:
   ```
   backdrop:bg-black/50 backdrop:backdrop-blur-sm
   ```

4. **Dialog panel styling** — match existing design system:
   ```
   Mobile (default):  fixed inset-x-0 bottom-0, rounded-t-2xl, full width, slide-up
   Desktop (sm+):     centered, max-w-md, rounded-xl, shadow-lg
   ```

5. **Escape key** — native `<dialog>` handles `Escape` automatically via the `cancel` event. Listen for `cancel` event and call `onOpenChange(false)`.

6. **Backdrop click** — listen for `click` on the `<dialog>` element itself (not its children). If `event.target === dialogRef.current`, close.

7. **Keyboard: `Cmd/Ctrl+Enter`** — submits (confirms). Follows project convention from AGENTS.md.

8. **Focus management** — on open, `autoFocus` the cancel button (safe default). If `cancelText` is `false`, focus the confirm button.

9. **Loading state** — when `loading` is `true`, the confirm button renders a spinner (`Loader2` icon with `animate-spin`), is disabled, and the dialog cannot be closed via Escape or backdrop click. This prevents the user from dismissing the dialog while an async action is in flight.

10. **Animations** — use Tailwind's `open:` modifier for the dialog and `backdrop:` for the overlay:
    ```
    open:animate-in open:fade-in-0 open:slide-in-from-bottom-4
    sm:open:slide-in-from-bottom-0 sm:open:zoom-in-95
    ```

11. **Reduced motion** — wrap animation classes with `motion-safe:` prefix. Users with `prefers-reduced-motion: reduce` see instant show/hide.

### Visual Mockups

#### Desktop Layout (>=640px) -- Centered Modal

```
         +-------------------------------------------+
         |                                    [x]    |
         |  TITLE                                    |
         |                                           |
         |  Text. Lorem Ipsum is simply dummy text   |
         |  of the printing and typesetting          |
         |  industry?                                |
         |                                           |
         |          +----------+ +--------------+    |
         |          |  CANCEL  | |   CONFIRM    |    |
         |          | (outline)| |  (filled/    |    |
         |          |          | |  destructive)|    |
         |          +----------+ +--------------+    |
         +-------------------------------------------+
```

- Max width: `max-w-md` (28rem / 448px)
- Rounded corners: `rounded-xl`
- Buttons: side by side, right-aligned (`flex-row justify-end`)
- Cancel: `variant="outline"`, Confirm: `variant="default"` or `variant="destructive"`
- Close button (x): top-right corner
- Title: left-aligned, `text-lg font-semibold`

#### Mobile Layout (<640px) -- Bottom Sheet

```
+----------------------------------------------+
|                                         [x]  |
|                                              |
|                    TITLE                     |
|                  (centered)                  |
|                                              |
|  Text. Lorem Ipsum is simply dummy text      |
|  of the printing and typesetting industry?   |
|                                              |
|  +--------------------------------------+    |
|  |              CONFIRM                 |    |
|  |        (filled / destructive)        |    |
|  |           full width                 |    |
|  +--------------------------------------+    |
|                                              |
|  +--------------------------------------+    |
|  |              CANCEL                  |    |
|  |           (outline)                  |    |
|  |           full width                 |    |
|  +--------------------------------------+    |
+----------------------------------------------+
              (device bottom edge)
```

- Full width: `w-full`, pinned to bottom (`inset-x-0 bottom-0`)
- Rounded corners: `rounded-t-2xl` (top only)
- Buttons: stacked vertically, full width (`flex-col-reverse`)
  - Confirm on TOP (visually), Cancel below -- via `flex-col-reverse` (DOM: cancel first -> confirm second, reverse renders confirm on top)
- Title: centered (`text-center`)
- Close button (x): top-right corner

#### Backdrop (both layouts)

- `::backdrop` pseudo-element styled via Tailwind: `backdrop:bg-black/50 backdrop:backdrop-blur-sm`
- Click on backdrop area fires `onOpenChange(false)` (unless `loading` is `true`)

### HTML Structure

```html
<dialog
  ref={dialogRef}
  role="alertdialog"
  aria-labelledby="confirm-dialog-title"
  aria-describedby="confirm-dialog-description"
  class="
    /* reset dialog defaults */
    m-0 p-0 max-w-none bg-transparent border-none
    /* backdrop */
    backdrop:bg-black/50 backdrop:backdrop-blur-sm backdrop:transition-opacity
    /* mobile: bottom sheet */
    fixed inset-x-0 bottom-0 w-full
    /* desktop: centered */
    sm:inset-auto sm:mx-auto sm:my-auto sm:max-w-md
    /* animation */
    motion-safe:open:animate-in motion-safe:open:fade-in-0
  "
>
  <div
    class="
      /* panel container */
      flex flex-col gap-4 rounded-t-2xl border-t bg-card p-6 shadow-lg
      sm:rounded-xl sm:border
    "
    role="document"
  >
    <!-- Title -->
    <h2 id="confirm-dialog-title" class="text-lg font-semibold leading-none tracking-tight">
      {title}
    </h2>

    <!-- Description (optional) -->
    {text && (
      <p id="confirm-dialog-description" class="text-sm text-muted-foreground">
        {text}
      </p>
    )}

    <!-- Actions -->
    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {cancelText !== false && (
        <Button variant="outline" onClick={handleCancel} disabled={loading}>
          {cancelText}
        </Button>
      )}
      {confirmText !== false && (
        <Button
          variant={variant === 'destructive' ? 'destructive' : 'default'}
          onClick={handleConfirm}
          disabled={loading}
        >
          {loading && <Loader2 class="mr-2 h-4 w-4 animate-spin" />}
          {confirmText}
        </Button>
      )}
    </div>
  </div>
</dialog>
```

### WCAG & Accessibility Requirements

| Requirement         | Implementation                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Role**            | `role="alertdialog"` -- indicates an urgent confirmation that interrupts workflow             |
| **Labelling**       | `aria-labelledby` pointing to title `<h2>`, `aria-describedby` pointing to description `<p>` |
| **Focus trap**      | Native `<dialog>.showModal()` provides focus trapping automatically                          |
| **Focus on open**   | Cancel button receives focus (safe default per WCAG best practice)                           |
| **Escape key**      | Native `<dialog>` `cancel` event -- closes dialog (blocked when `loading`)                   |
| **Keyboard submit** | `Cmd/Ctrl+Enter` fires confirm (project convention)                                          |
| **Tab order**       | Natural tab order: Cancel -> Confirm (cancel first = safe default)                           |
| **Backdrop click**  | Click on backdrop closes dialog (consistent with Radix Dialog, blocked when `loading`)        |
| **Screen reader**   | Title and description announced on open via `aria-labelledby`/`aria-describedby`             |
| **Reduced motion**  | Respect `prefers-reduced-motion` -- disable animations via `motion-safe:` prefix             |
| **Color contrast**  | Uses existing design system tokens which meet WCAG AA contrast ratios                        |
| **Touch target**    | Buttons use standard `h-9` height (36px) which meets WCAG 2.2 target size requirements       |

### Responsive Design

| Breakpoint             | Layout                                      | Title                         | Buttons                                                                                   | Corners                    |
| ---------------------- | ------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- | -------------------------- |
| **Mobile** (`<640px`)  | Bottom sheet -- full width, pinned to bottom | Centered (`text-center`)      | Stacked full-width via `flex-col-reverse` -- Confirm on top, Cancel below                 | `rounded-t-2xl` (top only) |
| **Desktop** (`>=640px`) | Centered modal -- `max-w-md`                | Left-aligned (`sm:text-left`) | Side by side, right-aligned via `sm:flex-row sm:justify-end` -- Cancel left, Confirm right | `rounded-xl`               |

Button order uses `flex-col-reverse`: DOM order is Cancel -> Confirm (tab order = safe default first), but `flex-col-reverse` visually places Confirm on top on mobile for thumb reach. On desktop, `sm:flex-row` restores natural left-to-right order.

---

## Part 1b: `useConfirmDialog` Hook

### File Location

**File:** `packages/ui/src/backend/confirm-dialog/useConfirmDialog.tsx` (new file)

### API

```typescript
export type ConfirmDialogOptions = {
  title?: string;
  text?: string;
  confirmText?: string | false;
  cancelText?: string | false;
  variant?: "default" | "destructive";
};

export type UseConfirmDialogReturn = {
  /** Call this to show a confirmation dialog. Resolves `true` if confirmed, `false` if cancelled. */
  confirm: (options?: ConfirmDialogOptions) => Promise<boolean>;
  /** Render this in your component tree (renders the <dialog> element) */
  ConfirmDialogElement: React.ReactNode;
};

export function useConfirmDialog(): UseConfirmDialogReturn;
```

### Behavior

- `confirm(options)` returns a `Promise<boolean>` -- resolves `true` on confirm, `false` on cancel/escape/backdrop click.
- Internally manages `open` state and a `resolveRef` for the Promise.
- Renders a `ConfirmDialog` component (controlled mode) that must be placed anywhere in the component tree.
- Multiple calls to `confirm()` queue -- only one dialog is shown at a time. Second call waits for the first to resolve.
- **Development-mode guard**: If `confirm()` is called but `ConfirmDialogElement` has not been mounted, emit `console.warn` with a clear message: `"useConfirmDialog: confirm() was called but ConfirmDialogElement is not rendered. Add {ConfirmDialogElement} to your JSX."` This prevents silent blocking.

### Usage Pattern

```typescript
// In a component:
const { confirm, ConfirmDialogElement } = useConfirmDialog()

async function handleDelete() {
  const ok = await confirm({
    title: t('customers.people.list.deleteConfirm', undefined, { name }),
    variant: 'destructive',
  })
  if (!ok) return
  // proceed with delete
}

return (
  <>
    {/* ... page content ... */}
    {ConfirmDialogElement}
  </>
)
```

This pattern mirrors the ergonomics of `window.confirm` -- the control flow stays linear with `await`, minimizing refactoring effort. **No provider or context required.**

---

## Part 1c: Barrel Export

### File Location

**File:** `packages/ui/src/backend/confirm-dialog/index.ts` (new file)

```typescript
export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";
export { useConfirmDialog } from "./useConfirmDialog";
export type {
  UseConfirmDialogReturn,
  ConfirmDialogOptions,
} from "./useConfirmDialog";
```

### Import Paths

Consumers import via:

```typescript
// Preferred -- direct subpath:
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog";
import { ConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog";

// Also works -- root barrel (packages/ui/src/index.ts re-exports):
import { useConfirmDialog } from "@open-mercato/ui";
```

### Re-export Update

**File:** `packages/ui/src/index.ts`

```diff
-export * from './backend/ConfirmDialog'
+export * from './backend/confirm-dialog'
```

---

## Part 2: Refactoring window.confirm Usages

### Refactoring Strategy

Every `window.confirm` call site is replaced with the `useConfirmDialog` hook (Pattern A). Existing `<ConfirmDialog>` wrapper usages are replaced with the declarative `<ConfirmDialog trigger={...}>` pattern (Pattern B).

### Pattern Transformation — Imperative (majority of call sites)

**Before:**

```typescript
function handleDelete(row: SomeEntity) {
  if (!window.confirm(t("module.list.confirmDelete", { name: row.name })))
    return;
  deleteCrud("/api/module/entity", row.id);
}
```

**After:**

```typescript
async function handleDelete(row: SomeEntity) {
  const ok = await confirm({
    title: t('module.list.confirmDelete', { name: row.name }),
    variant: 'destructive',
  })
  if (!ok) return
  deleteCrud('/api/module/entity', row.id)
}

// In render:
return (
  <>
    {/* ... existing JSX ... */}
    {ConfirmDialogElement}
  </>
)
```

### Pattern Transformation — Declarative (wrapper usages + new code)

**Before:**

```tsx
<ConfirmDialog
  trigger={<Button>Delete</Button>}
  title="Delete?"
  onConfirm={handleDelete}
/>
```

**After:**

```tsx
<ConfirmDialog
  trigger={<Button variant="destructive">{t('common.delete', 'Delete')}</Button>}
  title={t('module.confirm.delete.title', 'Delete Item')}
  text={t('module.confirm.delete.description', 'This action cannot be undone.')}
  variant="destructive"
  onConfirm={handleDelete}
/>
```

### Special Case: `typeof window !== 'undefined'` Guard

Some call sites use `typeof window !== 'undefined' && !window.confirm(...)` for SSR safety. The `useConfirmDialog` hook is client-side only (`"use client"`) and only runs in the browser, so this guard is no longer needed.

### Special Case: ConfirmDialog Component (Wrapper Pattern)

The current `ConfirmDialog` component is used as a wrapper with a `trigger` prop in 2 files. These are migrated to the new declarative `<ConfirmDialog trigger={...}>` pattern:

| File                                                            | Import path                                  |
| --------------------------------------------------------------- | -------------------------------------------- |
| `packages/core/src/modules/workflows/components/fields/StartPreConditionsEditor.tsx` | `@open-mercato/ui/backend/ConfirmDialog` |
| `packages/core/src/modules/workflows/components/fields/BusinessRuleConditionsEditor.tsx` | `@open-mercato/ui/backend/ConfirmDialog` |

### Complete Call Site Inventory

#### packages/ui (4 files, excluding ConfirmDialog.tsx itself)

| File                                                   | Line | Context                 | Variant     |
| ------------------------------------------------------ | ---- | ----------------------- | ----------- |
| `src/backend/custom-fields/FieldDefinitionsEditor.tsx` | 221  | Delete fieldset         | destructive |
| `src/backend/detail/NotesSection.tsx`                  | 715  | Delete note             | destructive |
| `src/backend/detail/ActivitiesSection.tsx`             | 1003 | Delete activity         | destructive |
| `src/backend/CrudForm.tsx`                             | 416  | Delete entity (generic) | destructive |

#### packages/core/modules/query_index (1 file)

| File                               | Line | Context              | Variant     |
| ---------------------------------- | ---- | -------------------- | ----------- |
| `components/QueryIndexesTable.tsx` | 277  | Purge vector index   | destructive |
| `components/QueryIndexesTable.tsx` | 311  | Purge fulltext index | destructive |

#### packages/core/modules/entities (1 file)

| File                                                | Line | Context       | Variant     |
| --------------------------------------------------- | ---- | ------------- | ----------- |
| `backend/entities/user/[entityId]/records/page.tsx` | 345  | Delete record | destructive |

#### packages/core/modules/resources (2 files)

| File                                        | Line | Context              | Variant     |
| ------------------------------------------- | ---- | -------------------- | ----------- |
| `backend/resources/resources/page.tsx`      | 343  | Delete resource      | destructive |
| `backend/resources/resource-types/page.tsx` | 227  | Delete resource type | destructive |

#### packages/core/modules/attachments (1 file)

| File                                         | Line | Context          | Variant     |
| -------------------------------------------- | ---- | ---------------- | ----------- |
| `components/AttachmentPartitionSettings.tsx` | 187  | Delete partition | destructive |

#### packages/core/modules/staff (3 files)

| File                                  | Line | Context            | Variant     |
| ------------------------------------- | ---- | ------------------ | ----------- |
| `backend/staff/team-roles/page.tsx`   | 299  | Delete team role   | destructive |
| `backend/staff/team-members/page.tsx` | 384  | Delete team member | destructive |
| `backend/staff/teams/page.tsx`        | 230  | Delete team        | destructive |

#### packages/core/modules/workflows (6 files + 2 wrapper usages)

| File                                          | Line | Context                  | Variant     | Pattern |
| --------------------------------------------- | ---- | ------------------------ | ----------- | ------- |
| `components/fields/FormFieldArrayEditor.tsx`  | 82   | Remove form field        | destructive | hook    |
| `components/fields/ActivityArrayEditor.tsx`   | 89   | Remove activity          | destructive | hook    |
| `components/fields/MappingArrayEditor.tsx`    | 74   | Remove mapping           | destructive | hook    |
| `components/fields/WorkflowSelectorField.tsx` | 106  | Clear workflow selection | default     | hook    |
| `components/NodeEditDialogCrudForm.tsx`       | 97   | Delete workflow step     | destructive | hook    |
| `components/EdgeEditDialogCrudForm.tsx`       | 79   | Delete transition        | destructive | hook    |
| `components/fields/StartPreConditionsEditor.tsx` | --  | `<ConfirmDialog>` wrapper | destructive | declarative |
| `components/fields/BusinessRuleConditionsEditor.tsx` | -- | `<ConfirmDialog>` wrapper | destructive | declarative |

#### packages/core/modules/directory (2 files)

| File                                       | Line | Context             | Variant     |
| ------------------------------------------ | ---- | ------------------- | ----------- |
| `backend/directory/organizations/page.tsx` | 177  | Delete organization | destructive |
| `backend/directory/tenants/page.tsx`       | 117  | Delete tenant       | destructive |

#### packages/core/modules/auth (2 files)

| File                     | Line | Context     | Variant     |
| ------------------------ | ---- | ----------- | ----------- |
| `backend/roles/page.tsx` | 72   | Delete role | destructive |
| `backend/users/page.tsx` | 347  | Delete user | destructive |

#### packages/core/modules/catalog (4 files)

| File                                            | Line | Context               | Variant     |
| ----------------------------------------------- | ---- | --------------------- | ----------- |
| `components/products/ProductsDataTable.tsx`     | 575  | Delete product        | destructive |
| `components/PriceKindSettings.tsx`              | 240  | Delete price kind     | destructive |
| `components/categories/CategoriesDataTable.tsx` | 165  | Delete category       | destructive |
| `backend/catalog/products/[id]/page.tsx`        | 1218 | Delete variant/option | destructive |

#### packages/core/modules/feature_toggles (1 file)

| File                                 | Line | Context               | Variant     |
| ------------------------------------ | ---- | --------------------- | ----------- |
| `components/FeatureTogglesTable.tsx` | 135  | Delete feature toggle | destructive |

#### packages/core/modules/api_keys (1 file)

| File                        | Line | Context        | Variant     |
| --------------------------- | ---- | -------------- | ----------- |
| `backend/api-keys/page.tsx` | 99   | Delete API key | destructive |

#### packages/core/modules/customers (7 files)

| File                                        | Line | Context                 | Variant     |
| ------------------------------------------- | ---- | ----------------------- | ----------- |
| `components/DictionarySettings.tsx`         | 190  | Delete dictionary entry | destructive |
| `backend/customers/companies/[id]/page.tsx` | 440  | Delete company          | destructive |
| `backend/customers/companies/page.tsx`      | 416  | Delete company          | destructive |
| `backend/customers/deals/page.tsx`          | 684  | Delete deal             | destructive |
| `backend/customers/deals/[id]/page.tsx`     | 249  | Delete deal             | destructive |
| `backend/customers/people/page.tsx`         | 423  | Delete person           | destructive |
| `backend/customers/people/[id]/page.tsx`    | 334  | Delete person           | destructive |
| `components/detail/DealsSection.tsx`        | 715  | Delete deal             | destructive |

#### packages/core/modules/sales (9 files)

| File                                           | Line | Context                 | Variant     |
| ---------------------------------------------- | ---- | ----------------------- | ----------- |
| `components/ShippingMethodsSettings.tsx`       | 619  | Delete shipping method  | destructive |
| `components/PaymentMethodsSettings.tsx`        | 371  | Delete payment method   | destructive |
| `components/TaxRatesSettings.tsx`              | 226  | Delete tax rate         | destructive |
| `components/StatusSettings.tsx`                | 192  | Delete status           | destructive |
| `components/documents/AddressesSection.tsx`    | 690  | Delete address          | destructive |
| `components/documents/ShipmentsSection.tsx`    | 382  | Confirm shipment action | default     |
| `components/documents/ItemsSection.tsx`        | 309  | Delete line item        | destructive |
| `components/documents/SalesDocumentsTable.tsx` | 532  | Delete sales document   | destructive |
| `components/AdjustmentKindSettings.tsx`        | 243  | Delete adjustment kind  | destructive |
| `backend/sales/documents/[id]/page.tsx`        | 3355 | Confirm action          | default     |
| `backend/sales/documents/[id]/page.tsx`        | 3605 | Confirm action          | default     |

#### packages/core/modules/planner (2 files)

| File                                             | Line | Context                | Variant     |
| ------------------------------------------------ | ---- | ---------------------- | ----------- |
| `backend/planner/availability-rulesets/page.tsx` | 124  | Delete ruleset         | destructive |
| `components/AvailabilityRulesEditor.tsx`         | 960  | Confirm ruleset action | default     |

#### packages/core/modules/configs (1 file)

| File                        | Line | Context     | Variant     |
| --------------------------- | ---- | ----------- | ----------- |
| `components/CachePanel.tsx` | 101  | Clear cache | destructive |
| `components/CachePanel.tsx` | 143  | Clear cache | destructive |

#### packages/core/modules/dictionaries (2 files)

| File                                     | Line | Context           | Variant     |
| ---------------------------------------- | ---- | ----------------- | ----------- |
| `components/DictionariesManager.tsx`     | 205  | Delete dictionary | destructive |
| `components/DictionaryEntriesEditor.tsx` | 182  | Delete entry      | destructive |

#### packages/scheduler (2 files)

| File                      | Line | Context           | Variant     |
| ------------------------- | ---- | ----------------- | ----------- |
| *(identified by Patryk)*  | --   | Schedule deletion | destructive |
| *(identified by Patryk)*  | --   | Schedule action   | destructive |

#### apps/mercato/modules/example (2 files)

| File                               | Line | Context     | Variant     |
| ---------------------------------- | ---- | ----------- | ----------- |
| `backend/todos/[id]/edit/page.tsx` | 137  | Delete todo | destructive |
| `components/TodosTable.tsx`        | 298  | Delete todo | destructive |

**Total: ~68 call sites across ~49 files** (includes 2 `<ConfirmDialog>` wrapper usages + `packages/scheduler`)

### Refactoring Execution Order

Execute in batches, verifying build between batches:

| Phase       | Files                                                                                                                                        | Rationale                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Phase 0** | `confirm-dialog/` folder: `ConfirmDialog.tsx` + `useConfirmDialog.tsx` + `index.ts`; update `index.ts` re-export                             | Component + hook + folder setup (old file NOT yet deleted) |
| **Phase 1** | `CrudForm.tsx`, `NotesSection.tsx`, `ActivitiesSection.tsx`, `FieldDefinitionsEditor.tsx`                                                    | `packages/ui` -- same package, highest reuse impact       |
| **Phase 2** | `customers/*` (8 sites)                                                                                                                      | High-traffic module, reference implementation for others |
| **Phase 3** | `sales/*` (11 sites)                                                                                                                         | Largest module, most call sites                          |
| **Phase 4** | `catalog/*` (4 sites), `auth/*` (2 sites)                                                                                                    | Core modules                                             |
| **Phase 5** | `staff/*`, `workflows/*` (8 sites including 2 declarative), `directory/*`                                                                    | Internal/admin modules                                   |
| **Phase 6** | `planner/*`, `configs/*`, `resources/*`, `entities/*`, `query_index/*`, `attachments/*`, `feature_toggles/*`, `api_keys/*`, `dictionaries/*` | Remaining modules                                        |
| **Phase 7** | `packages/scheduler/*` (2 sites)                                                                                                             | Separate package                                         |
| **Phase 8** | `apps/mercato/modules/example/*`                                                                                                             | Example/template module (last -- may be regenerated)      |
| **Phase 9** | Delete old `packages/ui/src/backend/ConfirmDialog.tsx`; update `AGENTS.md` with new pattern; add lint rule to prevent new `window.confirm()` | Final cleanup after all migrations verified               |

### Build Verification

After each phase, run:

```bash
yarn build:packages
```

After all phases complete:

```bash
yarn build && yarn lint
```

---

## Internationalization

### New i18n Keys

Add to all 4 locale files (`apps/mercato/src/i18n/{en,pl,de,es}.json`) and template files (`packages/create-app/template/src/i18n/{en,pl,de,es}.json`):

#### English

```json
{
  "ui.dialogs.confirm.confirmText": "Confirm",
  "ui.dialogs.confirm.cancelText": "Cancel"
}
```

#### Polish

```json
{
  "ui.dialogs.confirm.confirmText": "Potwierdz",
  "ui.dialogs.confirm.cancelText": "Anuluj"
}
```

#### German

```json
{
  "ui.dialogs.confirm.confirmText": "Bestatigen",
  "ui.dialogs.confirm.cancelText": "Abbrechen"
}
```

#### Spanish

```json
{
  "ui.dialogs.confirm.confirmText": "Confirmar",
  "ui.dialogs.confirm.cancelText": "Cancelar"
}
```

### Existing Keys (reused)

- `ui.dialogs.confirm.defaultTitle` -- already exists in all locales ("Are you sure?" / "Czy na pewno?" / etc.)
- `ui.dialog.close.ariaLabel` -- already exists ("Close" / "Zamknij" / etc.)

### i18n Key Convention for Call Sites

When migrating call sites, follow this naming convention for any new translation keys:

```
<module>.confirm.<action>.title       -> "Delete Customer"
<module>.confirm.<action>.description -> "This action cannot be undone."
```

---

## File Manifest

### New Files

| File                                                      | Purpose                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/ui/src/backend/confirm-dialog/ConfirmDialog.tsx`    | Native `<dialog>` component (controlled + declarative modes) |
| `packages/ui/src/backend/confirm-dialog/useConfirmDialog.tsx` | Hook returning `confirm()` Promise + `ConfirmDialogElement`  |
| `packages/ui/src/backend/confirm-dialog/index.ts`             | Barrel export for public API                                 |

### Deleted Files

| File                                        | Reason                                         | When           |
| ------------------------------------------- | ---------------------------------------------- | -------------- |
| `packages/ui/src/backend/ConfirmDialog.tsx` | Replaced by `confirm-dialog/ConfirmDialog.tsx` | Phase 9 (last) |

### Modified Files

| File                                                            | Changes                                              |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/ui/src/index.ts`                                      | Update re-export: `'./backend/ConfirmDialog'` -> `'./backend/confirm-dialog'` |
| `apps/mercato/src/i18n/en.json`                                 | Add `confirmText`, `cancelText` keys                 |
| `apps/mercato/src/i18n/pl.json`                                 | Add `confirmText`, `cancelText` keys                 |
| `apps/mercato/src/i18n/de.json`                                 | Add `confirmText`, `cancelText` keys                 |
| `apps/mercato/src/i18n/es.json`                                 | Add `confirmText`, `cancelText` keys                 |
| `packages/create-app/template/src/i18n/en.json`                 | Add `confirmText`, `cancelText` keys                 |
| `packages/create-app/template/src/i18n/pl.json`                 | Add `confirmText`, `cancelText` keys                 |
| `packages/create-app/template/src/i18n/de.json`                 | Add `confirmText`, `cancelText` keys                 |
| `packages/create-app/template/src/i18n/es.json`                 | Add `confirmText`, `cancelText` keys                 |
| `packages/ui/AGENTS.md`                                         | Document new confirmation pattern (Phase 9)          |
| ~49 files across `packages/ui`, `packages/core`, `packages/scheduler`, `apps/mercato` | Replace `window.confirm` with `useConfirmDialog` or declarative `<ConfirmDialog>` |

---

## Design Decisions

### 1. Native `<dialog>` over Radix UI AlertDialog

The native `<dialog>` element provides modal behavior, focus trapping, `Escape` key handling, and `::backdrop` support out of the box -- with zero JavaScript runtime cost. For a simple yes/no confirmation, this is sufficient. Adding `@radix-ui/react-alert-dialog` (~3KB gzip) would introduce a new dependency for a component that does less than what `<dialog>` provides natively. The existing Radix UI Dialog remains for complex dialogs (forms, metadata editors) where portal rendering, animation orchestration, and composable sub-components are needed.

### 2. `role="alertdialog"` over `role="dialog"`

Per WAI-ARIA, `alertdialog` is specifically designed for urgent confirmation dialogs that interrupt the user's workflow. This triggers screen readers to announce the dialog immediately and indicates the user must respond before continuing.

### 3. Two usage patterns: hook + declarative

The **hook** (`useConfirmDialog`) provides a Promise-based `confirm()` that preserves the linear control flow of `window.confirm()`, minimizing migration diff. The **declarative** `<ConfirmDialog trigger={...}>` is more ergonomic for new code where the trigger is inline -- no hook destructuring, no `{ConfirmDialogElement}` in JSX. Both patterns use the same underlying `ConfirmDialog` component; the declarative mode simply manages its own `open` state. Neither requires a context provider.

### 4. No provider required

Both patterns work without a `ConfirmationProvider` in the component tree. The hook is self-contained (renders its own `<dialog>` via `ConfirmDialogElement`), and the declarative component manages state internally. This eliminates an entire class of "provider missing" runtime errors and simplifies setup.

### 5. Cancel button focused by default

WCAG best practice for destructive confirmations: the safe action (cancel) receives initial focus so accidental `Enter` presses don't trigger the destructive action. When `cancelText` is `false` (no cancel button), focus moves to the confirm button.

### 6. Bottom-sheet on mobile, centered on desktop

Matches the existing pattern in `packages/ui/src/primitives/dialog.tsx` (lines 44-47). Bottom-sheet is ergonomic on touch devices -- the buttons are within thumb reach. Centered modal is standard on desktop.

### 7. `confirmText` / `cancelText` as `string | false`

`false` hides the button entirely. This handles edge cases like:
- Information-only dialogs (only OK button, no cancel) -- pass `cancelText: false`
- Dialogs where the only action is to acknowledge -- pass `confirmText: false`, keep cancel as "Close"

### 8. `loading` prop for async confirmations

Adopted from Patryk's spec. Some confirm handlers need to wait for an API response before closing the dialog (e.g., server-side validation). The `loading` prop disables both buttons, shows a spinner on Confirm, and blocks Escape/backdrop dismissal. This prevents the user from interacting while the async operation completes.

### 9. `variant: 'destructive'` for delete confirmations

~90% of `window.confirm` call sites are delete confirmations. The `destructive` variant renders the confirm button with `bg-destructive` (red), making the destructive nature visually clear.

### 10. Deferred cleanup of old file (Phase 9)

Adopted from Patryk's spec. The old `ConfirmDialog.tsx` is not deleted until all call sites are migrated and verified (Phase 9). During migration, both old and new patterns coexist safely. This is safer than immediate deletion (Adam's Phase 0 approach) because it allows incremental rollout without forcing all imports to update simultaneously.

### 11. Dedicated `confirm-dialog/` folder instead of flat file

The component + hook + barrel export are placed in `packages/ui/src/backend/confirm-dialog/` rather than as flat files in `packages/ui/src/backend/`. This follows the existing pattern used by `version-history/`, `custom-fields/`, and `detail/` -- colocating related files in a named subfolder.

---

## Risks & Impact Review

### Data Integrity Failures

#### Async Confirm Race Condition

- **Scenario**: User double-clicks a delete button. Two `confirm()` Promises are created. User confirms the first, which resolves and triggers the delete. The second dialog appears after the entity is already deleted.
- **Severity**: Low
- **Affected area**: All delete handlers
- **Mitigation**: The `useConfirmDialog` hook queues concurrent `confirm()` calls -- only one dialog is shown at a time. Second call waits for the first to resolve. Additionally, most delete handlers already have server-side idempotency (deleting an already-deleted entity returns 404, which `deleteCrud` handles gracefully).
- **Residual risk**: None -- the queuing behavior prevents duplicate dialogs.

### Cascading Failures & Side Effects

#### Hook Not Rendered (hook pattern)

- **Scenario**: A developer calls `confirm()` but forgets to include `{ConfirmDialogElement}` in the JSX return. The dialog never appears and the Promise never resolves, silently blocking the handler.
- **Severity**: Medium
- **Affected area**: Any component using `useConfirmDialog`
- **Mitigation**: Development-mode `console.warn` if `confirm()` is called but the dialog element has not been mounted. TypeScript return type forces destructuring both `confirm` and `ConfirmDialogElement`, making omission visible in code review. JSDoc documentation. The declarative `<ConfirmDialog trigger={...}>` pattern avoids this issue entirely.
- **Residual risk**: Acceptable -- developer error, caught in manual QA.

### Migration & Deployment Risks

#### Incremental Rollout Compatibility

- **Scenario**: During phased rollout, some components use the new `useConfirmDialog`, others still use `window.confirm`. Both work correctly and coexist.
- **Severity**: Low
- **Affected area**: UI consistency during migration
- **Mitigation**: Old file preserved until Phase 9. Old and new patterns coexist safely. No breaking changes.
- **Residual risk**: Temporary visual inconsistency during migration -- acceptable and short-lived.

#### Async Confirmation Changes Control Flow

- **Scenario**: `confirm()` returns a Promise, so handlers must be `async`. Existing handlers that aren't `async` need modification.
- **Severity**: Medium
- **Affected area**: ~68 files during migration
- **Mitigation**: Most handlers are already `async` (they call `apiCallOrThrow`, `deleteCrud`, etc.). For the few that aren't, adding `async` is a safe, mechanical change. No behavioral difference.
- **Residual risk**: None.

### Operational Risks

#### Browser Compatibility

- **Scenario**: The `<dialog>` element is not supported in the target browser.
- **Severity**: Low
- **Affected area**: Dialog rendering
- **Mitigation**: `<dialog>` has baseline browser support since March 2022 (Chrome 37+, Firefox 98+, Safari 15.4+, Edge 79+). The project's browserslist targets modern browsers only. No polyfill needed.
- **Residual risk**: None for supported browsers.

#### SSR Compatibility

- **Scenario**: `confirm()` or `<ConfirmDialog>` used in a server component.
- **Severity**: Low
- **Affected area**: SSR rendering
- **Mitigation**: Both components are `"use client"`. The existing `typeof window !== 'undefined'` guard is no longer needed since dialogs are client-only by definition.
- **Residual risk**: None.

### Tenant & Data Isolation Risks

- **None** -- `ConfirmDialog` is a pure UI component with no data access. Tenant isolation is enforced by the API handlers that execute after confirmation.

---

## Changelog

### 2026-02-12

- Initial specification
- Combined best practices from Adam's spec (native `<dialog>`, detailed call site inventory, responsive design, animations, a11y) and Patryk's spec (declarative trigger pattern, loading state, deferred cleanup, scheduler coverage)
