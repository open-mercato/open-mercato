# SPEC-016: Form Headers & Footers Design System Components

## Overview

This specification defines three reusable UI components for form/detail page headers and footers: `FormHeader`, `FormFooter`, and `FormActionButtons`. These components replace the duplicated header/footer code found across 57+ admin pages, providing a single source of truth for layout, styling, and button behavior.

This is the first step toward an official Open Mercato design system.

## Problem Statement

The codebase has significant header/footer duplication:

1. **CrudForm** (`packages/ui/src/backend/CrudForm.tsx`) renders the same header block 2 times (grouped layout + default layout) and the same footer block 2 times -- totaling 4 near-identical copies of the button bar (Delete/Cancel/Save).
2. **Detail pages** (sales documents, customer people/companies/deals, workflow tasks/events/instances) each manually implement the same responsive header layout (`flex flex-col gap-3 md:flex-row md:items-center md:justify-between`) with back link, title area, and action buttons.
3. The header and footer in CrudForm contain the **exact same buttons** but are implemented as separate JSX blocks with no shared component.

This leads to:

- Inconsistent styling when pages drift (e.g., different border colors on delete buttons)
- High effort to make global UI changes
- Risk of partial updates when modifying button behavior

## Proposed Solution

Four new components in `packages/ui/src/backend/forms/`:

| Component | Purpose |
|-----------|---------|
| **FormActionButtons** | Atomic button bar: `[extraActions] [Delete] [Cancel] [Save]` -- used in edit mode headers and footers |
| **FormHeader** | Page header with two modes: `edit` (compact, for forms) and `detail` (large title, status badge, Actions dropdown for view pages) |
| **FormFooter** | Form footer wrapping `FormActionButtons` with embedded/dialog awareness |
| **ActionsDropdown** | Dropdown menu button labeled "Actions" that groups context-specific actions (convert, send, export, etc.) -- used in detail mode headers |

Import path: `@open-mercato/ui/backend/forms`

## Architecture

### File Structure

```
packages/ui/src/backend/forms/
  FormActionButtons.tsx
  ActionsDropdown.tsx
  FormHeader.tsx
  FormFooter.tsx
  index.ts
```

### Component Hierarchy

```
FormHeader
  ├── Back link (← arrow + label)
  ├── Title area (edit: small text / detail: large h1 + entityTypeLabel + subtitle + statusBadge)
  └── Actions area
      ├── edit mode  → FormActionButtons (Delete/Cancel/Save)
      └── detail mode → [Actions ▼] (optional, only if menuActions provided) + [Delete] (always separate)

FormFooter
  └── FormActionButtons

CrudForm (internal)
  ├── FormHeader mode="edit"
  ├── <form> content
  └── FormFooter
```

### Dependency Graph

```
FormActionButtons  ← used by FormHeader (edit mode), FormFooter, standalone
ActionsDropdown    ← used by FormHeader (detail mode), standalone
FormHeader         ← used by CrudForm (internally), detail pages (directly)
FormFooter         ← used by CrudForm (internally)
```

## Component API

### FormActionButtons

The atomic building block shared between header and footer.

```typescript
export type FormActionButtonsProps = {
  /** Extra action buttons rendered before the standard buttons */
  extraActions?: React.ReactNode
  /** Show the delete button */
  showDelete?: boolean
  /** Callback when delete is clicked */
  onDelete?: () => void
  /** Label for the delete button */
  deleteLabel?: string
  /** Whether the delete button shows a loading spinner */
  isDeleting?: boolean
  /** URL for the cancel link */
  cancelHref?: string
  /** Label for the cancel link */
  cancelLabel?: string
  /** Submit button configuration */
  submit?: {
    /** Form ID for the submit button (needed in header to trigger form submit) */
    formId?: string
    /** Whether the form is currently submitting */
    pending?: boolean
    /** Label while idle */
    label?: string
    /** Label while saving */
    pendingLabel?: string
  }
  /** When true, hides all buttons */
  hidden?: boolean
}
```

**Rendering order:** `[extraActions] [Delete] [Cancel] [Save]`

**Button styling:**

| Button | Variant | Classes |
|--------|---------|---------|
| Delete | `outline` | `text-red-600 border-red-200 hover:bg-red-50 rounded` |
| Cancel | Link-styled | `h-9 inline-flex items-center rounded border px-3 text-sm` |
| Save | `default` | Primary button, `<Save>` icon |

**Default labels** (via `useT()`):

| Button | i18n key | Fallback |
|--------|----------|----------|
| Delete | `ui.actions.delete` | `Delete` |
| Cancel | `ui.actions.cancel` | `Cancel` |
| Save | `ui.actions.save` | `Save` |
| Saving | `ui.actions.saving` | `Saving...` |

### ActionsDropdown

Dropdown menu that groups **additional context-specific actions** under a single "Actions" button. Only visible when `menuActions` has items -- hidden entirely when there are no additional actions. Delete is **never** inside this dropdown; it is always a standalone button.

```typescript
export type ActionItem = {
  /** Unique key */
  id: string
  /** Display label */
  label: string
  /** Lucide icon component (optional) */
  icon?: React.ComponentType<{ className?: string }>
  /** Click handler */
  onSelect: () => void
  /** Disable the item */
  disabled?: boolean
  /** Show a loading spinner instead of the icon */
  loading?: boolean
}

export type ActionsDropdownProps = {
  /** Items to render inside the dropdown */
  items: ActionItem[]
  /** Button label (default: translated 'Actions') */
  label?: string
  /** Button size (default: 'sm') */
  size?: 'sm' | 'default'
}
```

Renders a `DropdownMenu` from shadcn primitives with a trigger `Button variant="outline"` and `ChevronDown` icon. Each item renders as a `DropdownMenuItem` with optional icon and label.

**Layout:**

```
┌─────────────┐
│ Actions  ▼  │
├─────────────┤
│ 🔄 Convert  │
│ 📧 Send     │
│ 📄 Print    │
└─────────────┘
```

**Visibility rule:** The entire "Actions" button is hidden when `menuActions` is empty or not provided. Pages with only a Delete action (e.g., customer deals) render just the Delete button without the dropdown.

### FormHeader

Unified header with a `mode` discriminator.

```typescript
/** Base props shared by both modes */
type FormHeaderBaseProps = {
  /** Back link URL */
  backHref?: string
  /** Back link label */
  backLabel?: string
}

/** Edit mode: compact header for CrudForm pages */
export type FormHeaderEditProps = FormHeaderBaseProps & {
  mode?: 'edit'
  /** Small title next to the back link */
  title?: string
  /** Structured action buttons (Delete/Cancel/Save) */
  actions?: FormActionButtonsProps
  /** Custom right-side content (overrides `actions`) */
  actionsContent?: React.ReactNode
}

/** Detail mode: large header for view/detail pages */
export type FormHeaderDetailProps = FormHeaderBaseProps & {
  mode: 'detail'
  /** Large title -- string renders as h1; ReactNode for InlineTextEditor */
  title?: React.ReactNode
  /** Small uppercase entity type label above the title */
  entityTypeLabel?: string
  /** Subtitle text below the title */
  subtitle?: string
  /** Status badge or similar element below the title */
  statusBadge?: React.ReactNode
  /** Context actions grouped into an "Actions" dropdown (preferred) */
  menuActions?: ActionItem[]
  /** Optional utility actions (icon-only) displayed before menu actions */
  utilityActions?: React.ReactNode
  /** Delete action -- rendered as a standalone destructive button next to the dropdown */
  onDelete?: () => void
  /** Delete button label */
  deleteLabel?: string
  /** Whether delete is in progress */
  isDeleting?: boolean
  /** Fallback: fully custom right-side content (overrides menuActions + onDelete) */
  actionsContent?: React.ReactNode
}

export type FormHeaderProps = FormHeaderEditProps | FormHeaderDetailProps
```

**Edit mode layout:**

```
┌──────────────────────────────────────────────────────┐
│ ← Back label  Title          [Delete] [Cancel] [Save]│
└──────────────────────────────────────────────────────┘
```

CSS: `flex items-center justify-between gap-3`

**Detail mode layout:**

```
┌──────────────────────────────────────────────────────┐
│ ←  ENTITY TYPE LABEL              [Actions ▼] [🗑Del]│
│    Title (large h1)                                   │
│    Status Badge                                       │
│    Subtitle                                           │
└──────────────────────────────────────────────────────┘
```

CSS: `flex flex-col gap-3 md:flex-row md:items-center md:justify-between`

Responsive: stacks vertically on mobile, side-by-side on `md+`.

**Detail mode action area rules:**

1. **Delete** is always a standalone destructive button (red outline, `Trash2` icon) -- never inside the dropdown.
2. **Actions dropdown** is only rendered when `menuActions` has items. Hidden entirely otherwise.
3. If `actionsContent` is provided, it overrides both dropdown and delete button (full escape hatch).
4. If neither `menuActions`, `onDelete`, nor `actionsContent` is provided, the right side is empty.

### FormFooter

Thin wrapper around `FormActionButtons` with embedded/dialog layout awareness.

```typescript
export type FormFooterProps = {
  /** Action buttons to render */
  actions: FormActionButtonsProps
  /** When embedded, justify-end; otherwise justify-between */
  embedded?: boolean
  /** Extra className for dialog sticky positioning */
  className?: string
}
```

## UI/UX

### Visual Consistency Rules

1. **Delete button** always uses red outline variant with `Trash2` icon
2. **Save button** always uses default (primary) variant with `Save` icon
3. **Cancel** is always a styled `Link` (not a `Button`)
4. **Back link** uses `←` arrow with `text-sm text-muted-foreground hover:text-foreground`
5. In **detail mode**, back link uses `sr-only` span for accessibility
6. **Title** in edit mode: `text-base font-medium`; in detail mode: `text-2xl font-semibold leading-tight`
7. **Entity type label** in detail mode: `text-xs uppercase text-muted-foreground`

### Keyboard Support

- `Cmd/Ctrl + Enter` submits the form (handled by CrudForm, not by these components)
- `Escape` cancels (handled by CrudForm/dialog wrapper)

## Usage Examples

### Edit mode (inside CrudForm -- automatic)

CrudForm uses `FormHeader` and `FormFooter` internally. No changes needed by consumers:

```tsx
<CrudForm
  title="Edit category"
  backHref="/backend/catalog/categories"
  cancelHref="/backend/catalog/categories"
  submitLabel="Save"
  onDelete={handleDelete}
  extraActions={<span className="text-xs text-muted-foreground">Path: Fashion / Men</span>}
  {...otherProps}
/>
```

### Detail mode -- sales quote with Actions dropdown

```tsx
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ArrowRightLeft, Send, Printer } from 'lucide-react'

<FormHeader
  mode="detail"
  backHref="/backend/sales/quotes"
  backLabel="Back to quotes"
  entityTypeLabel="Sales quote"
  title={<InlineTextEditor value={number} onSave={handleSave} ... />}
  statusBadge={
    <Badge variant="secondary">
      <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
      Sent
    </Badge>
  }
  menuActions={[
    { id: 'convert', label: 'Convert to order', icon: ArrowRightLeft, onSelect: handleConvert },
    { id: 'send', label: 'Send to customer', icon: Send, onSelect: handleSend, disabled: !contactEmail },
    { id: 'print', label: 'Print / Download', icon: Printer, onSelect: handlePrint },
  ]}
  onDelete={handleDelete}
  isDeleting={deleting}
/>
```

### Detail mode -- simple (customer deal)

```tsx
<FormHeader
  mode="detail"
  backHref="/backend/customers/deals"
  backLabel="Back to deals"
  title={data.deal.title || 'Untitled deal'}
  subtitle={`Status: ${statusLabel} | Pipeline: ${pipelineLabel}`}
  onDelete={handleDelete}
  isDeleting={isDeleting}
/>
```

### FormActionButtons (standalone)

```tsx
import { FormActionButtons } from '@open-mercato/ui/backend/forms'

<FormActionButtons
  showDelete
  onDelete={handleDelete}
  cancelHref="/backend/customers/people"
  submit={{ formId: 'my-form', pending: isSaving, label: 'Save changes' }}
/>
```

### FormFooter (standalone)

```tsx
import { FormFooter } from '@open-mercato/ui/backend/forms'

<FormFooter
  embedded={false}
  actions={{
    showDelete: true,
    onDelete: handleDelete,
    cancelHref: '/backend/list',
    submit: { pending: false, label: 'Save' },
  }}
/>
```

## Migration Path

### Phase 1: Non-breaking internal refactor

CrudForm replaces its 4 duplicated header/footer blocks with the new components. CrudForm's public API is unchanged -- all 51 consumer pages work without modification.

### Phase 2: Detail page migration

Each detail page replaces 15-50 lines of inline header JSX with a single `<FormHeader mode="detail" ... />` call. Pages with multiple action buttons (quotes, workflow instances) migrate to `menuActions` array for the Actions dropdown.

## Exhaustive File List

### Component files to create

| File | Description |
|------|-------------|
| `packages/ui/src/backend/forms/FormActionButtons.tsx` | Shared button bar (Delete/Cancel/Save) |
| `packages/ui/src/backend/forms/ActionsDropdown.tsx` | Actions dropdown menu for detail headers |
| `packages/ui/src/backend/forms/FormHeader.tsx` | Unified header (edit + detail modes) |
| `packages/ui/src/backend/forms/FormFooter.tsx` | Footer wrapper |
| `packages/ui/src/backend/forms/index.ts` | Re-exports |

### CrudForm internal refactor (1 file)

| File | Change |
|------|--------|
| `packages/ui/src/backend/CrudForm.tsx` | Replace 4 duplicated header/footer blocks with FormHeader + FormFooter. No public API change. |

### CrudForm consumer pages (automatic -- no changes needed)

These 51 pages pass props to CrudForm which internally uses the new components. **No file modifications required.**

**api_keys:**
- `packages/core/src/modules/api_keys/backend/api-keys/create/page.tsx`

**auth:**
- `packages/core/src/modules/auth/backend/roles/[id]/edit/page.tsx`
- `packages/core/src/modules/auth/backend/roles/create/page.tsx`
- `packages/core/src/modules/auth/backend/users/[id]/edit/page.tsx`
- `packages/core/src/modules/auth/backend/users/create/page.tsx`

**business_rules:**
- `packages/core/src/modules/business_rules/backend/rules/[id]/page.tsx`
- `packages/core/src/modules/business_rules/backend/rules/create/page.tsx`
- `packages/core/src/modules/business_rules/backend/sets/[id]/page.tsx`
- `packages/core/src/modules/business_rules/backend/sets/create/page.tsx`

**catalog:**
- `packages/core/src/modules/catalog/backend/catalog/categories/[id]/edit/page.tsx`
- `packages/core/src/modules/catalog/backend/catalog/categories/create/page.tsx`
- `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx`
- `packages/core/src/modules/catalog/backend/catalog/products/[productId]/variants/[variantId]/page.tsx`
- `packages/core/src/modules/catalog/backend/catalog/products/[productId]/variants/create/page.tsx`
- `packages/core/src/modules/catalog/backend/catalog/products/create/page.tsx`

**currencies:**
- `packages/core/src/modules/currencies/backend/currencies/[id]/page.tsx`
- `packages/core/src/modules/currencies/backend/currencies/create/page.tsx`
- `packages/core/src/modules/currencies/backend/exchange-rates/[id]/page.tsx`
- `packages/core/src/modules/currencies/backend/exchange-rates/create/page.tsx`

**customers:**
- `packages/core/src/modules/customers/backend/customers/companies/create/page.tsx`
- `packages/core/src/modules/customers/backend/customers/deals/create/page.tsx`
- `packages/core/src/modules/customers/backend/customers/people/create/page.tsx`

**directory:**
- `packages/core/src/modules/directory/backend/directory/organizations/[id]/edit/page.tsx`
- `packages/core/src/modules/directory/backend/directory/organizations/create/page.tsx`
- `packages/core/src/modules/directory/backend/directory/tenants/[id]/edit/page.tsx`
- `packages/core/src/modules/directory/backend/directory/tenants/create/page.tsx`

**entities:**
- `packages/core/src/modules/entities/backend/entities/user/[entityId]/page.tsx`
- `packages/core/src/modules/entities/backend/entities/user/[entityId]/records/[recordId]/page.tsx`
- `packages/core/src/modules/entities/backend/entities/user/[entityId]/records/create/page.tsx`
- `packages/core/src/modules/entities/backend/entities/user/create/page.tsx`

**feature_toggles:**
- `packages/core/src/modules/feature_toggles/backend/feature-toggles/global/[id]/edit/page.tsx`
- `packages/core/src/modules/feature_toggles/backend/feature-toggles/global/create/page.tsx`

**planner:**
- `packages/core/src/modules/planner/backend/planner/availability-rulesets/[id]/page.tsx`
- `packages/core/src/modules/planner/backend/planner/availability-rulesets/create/page.tsx`

**resources:**
- `packages/core/src/modules/resources/backend/resources/resources/[id]/page.tsx`
- `packages/core/src/modules/resources/backend/resources/resources/create/page.tsx`

**sales:**
- `packages/core/src/modules/sales/backend/sales/channels/[channelId]/edit/page.tsx`
- `packages/core/src/modules/sales/backend/sales/channels/create/page.tsx`

**staff:**
- `packages/core/src/modules/staff/backend/staff/leave-requests/[id]/page.tsx`
- `packages/core/src/modules/staff/backend/staff/leave-requests/create/page.tsx`
- `packages/core/src/modules/staff/backend/staff/my-leave-requests/[id]/page.tsx`
- `packages/core/src/modules/staff/backend/staff/my-leave-requests/create/page.tsx`
- `packages/core/src/modules/staff/backend/staff/profile/create/page.tsx`
- `packages/core/src/modules/staff/backend/staff/team-members/[id]/page.tsx`
- `packages/core/src/modules/staff/backend/staff/team-members/create/page.tsx`
- `packages/core/src/modules/staff/backend/staff/team-roles/[id]/edit/page.tsx`
- `packages/core/src/modules/staff/backend/staff/team-roles/create/page.tsx`
- `packages/core/src/modules/staff/backend/staff/teams/[id]/edit/page.tsx`
- `packages/core/src/modules/staff/backend/staff/teams/create/page.tsx`

**workflows:**
- `packages/core/src/modules/workflows/backend/definitions/[id]/page.tsx`
- `packages/core/src/modules/workflows/backend/definitions/create/page.tsx`

**example (app module):**
- `apps/mercato/src/modules/example/backend/todos/[id]/edit/page.tsx`
- `apps/mercato/src/modules/example/backend/todos/create/page.tsx`

### Detail pages to migrate manually (8 files)

These pages have custom inline header JSX that must be replaced with `<FormHeader mode="detail" .../>`.

| File | Complexity | Current actions | Migration target |
|------|-----------|-----------------|------------------|
| `packages/core/src/modules/workflows/backend/tasks/[id]/page.tsx` | Simple | Status badge only | `title` + `statusBadge` |
| `packages/core/src/modules/workflows/backend/events/[id]/page.tsx` | Simple | Badge only | `title` + `statusBadge` |
| `packages/core/src/modules/workflows/backend/instances/[id]/page.tsx` | Simple | Cancel + Retry buttons | `menuActions` (cancel, retry) |
| `packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx` | Simple | Save + Validate + Test buttons | `menuActions` (validate, test) + `actions.submit` |
| `packages/core/src/modules/customers/backend/customers/deals/[id]/page.tsx` | Medium | Edit shortcut + Delete | `title` + `onDelete` |
| `packages/core/src/modules/customers/components/detail/PersonHighlights.tsx` | Medium | InlineTextEditor + Delete | `title` (ReactNode) + `onDelete` |
| `packages/core/src/modules/customers/components/detail/CompanyHighlights.tsx` | Medium | InlineTextEditor + Delete | `title` (ReactNode) + `onDelete` |
| `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx` | Complex | Convert + Send + Print + Delete | `menuActions` (convert, send, print) + `onDelete` + `entityTypeLabel` + `statusBadge` |

### Documentation files to update (2 files)

| File | Change |
|------|--------|
| `.ai/specs/SPEC-001-2026-01-21-ui-reusable-components.md` | Add FormHeader, FormFooter, FormActionButtons, ActionsDropdown to component tables + usage examples |
| `AGENTS.md` | Add reference in UI Interaction section about using FormHeader/FormFooter for new pages |

## Alternatives Considered

### Two separate components (EditFormHeader / DetailFormHeader)

**Rejected.** The back-link logic, responsive container, and action button slot are shared. A single component with `mode` discriminator is simpler and avoids API surface duplication.

### Extending existing PageHeader

**Rejected.** The existing `PageHeader` in `Page.tsx` is a minimal layout helper (title + description + actions). It doesn't support back links, edit/detail mode distinction, or the responsive detail layout. Extending it would break its simplicity. The new `FormHeader` serves a different, more specific purpose.

### Passing full JSX children instead of structured props

**Rejected for edit mode**, where all CrudForm pages need the same button bar. Structured props reduce boilerplate. **Supported for detail mode** via `actionsContent` escape hatch, since detail pages have highly varied action buttons.

## Success Metrics

1. **Zero duplicated header/footer JSX** in CrudForm (currently 4 copies -> 0)
2. **All detail pages** use `FormHeader` instead of inline flex layouts
3. **Build passes** with no TypeScript errors
4. **Visual parity** -- headers and footers look identical before and after refactor
5. **Reduced lines of code** -- estimated ~200-400 lines removed across the codebase

## Open Questions

None at this time. The component APIs are designed to handle all existing patterns found in the codebase.

## Changelog

### 2026-02-04
- Added `utilityActions` slot for icon-only actions in `FormHeader` detail mode

### 2026-02-03

- Initial specification
