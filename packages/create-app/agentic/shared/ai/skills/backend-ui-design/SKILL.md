---
name: backend-ui-design
description: Design and implement consistent backend/backoffice interfaces using @open-mercato/ui. Use when building admin pages, CRUD interfaces, data tables, forms, detail pages, or any backoffice UI.
---

# Backend UI Design

Guide for creating consistent, production-grade backend interfaces using the `@open-mercato/ui` component library. All implementations must use existing components for visual and behavioral consistency.

For complete component API reference, see `references/ui-components.md`.

## Design Principles

1. **Consistency First**: Every page should feel like part of the same application.
2. **Component Reuse**: Never create custom implementations when a shared component exists.
3. **Data Density**: Admin users need information-rich interfaces. Optimize for scanning.
4. **Keyboard Navigation**: `Cmd/Ctrl+Enter` for primary actions, `Escape` to cancel.
5. **Clear Hierarchy**: Page → Section → Content. Use `PageHeader`, `PageBody`, consistent spacing.

## Required Component Library

ALWAYS import from `@open-mercato/ui`.

### Core Layout

```tsx
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'

<Page>
  <PageHeader>{/* Title, actions, breadcrumbs */}</PageHeader>
  <PageBody>{/* Main content */}</PageBody>
</Page>
```

### Data Display (Lists)

Use `DataTable` for ALL tabular data. Never implement custom tables.

```tsx
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { TruncatedCell } from '@open-mercato/ui/backend/TruncatedCell'
import { BooleanIcon, EnumBadge } from '@open-mercato/ui/backend/ValueIcons'
```

Column patterns:
- Text: `TruncatedCell` with `meta.maxWidth`
- Boolean: `BooleanIcon`
- Status/enum: `EnumBadge` with severity presets
- Actions: `RowActions` for context menus

### DataTable Pagination

DataTable MUST be configured with pagination props to display all data correctly. Without these, the table only shows the first page with no way to navigate:

```tsx
<DataTable
  columns={columns}
  data={items}
  page={page}
  pageSize={pageSize}
  totalCount={totalCount}
  onPageChange={setPage}
/>
```

When using a custom API (not `makeCrudRoute`), ensure the list response always returns:
- `items` — array of records for the current page
- `totalCount` — total records matching the query (not just the current page)
- `page` — current page number (1-based)
- `pageSize` — records per page

The default `pageSize` is 25. Keep at or below 100. If you see fewer records than expected, verify your API returns `totalCount` and the DataTable has pagination props wired.

### Forms

Use `CrudForm` for ALL forms. Never build from scratch.

```tsx
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
```

Field types: `text`, `textarea`, `number`, `email`, `password`, `select`, `multiselect`, `combobox`, `checkbox`, `switch`, `date`, `datetime`, `custom`.

### Form Headers & Footers

```tsx
import { FormHeader, FormFooter, FormActionButtons, ActionsDropdown } from '@open-mercato/ui/backend/forms'
```

- **`FormHeader mode="edit"`** — compact header for CrudForm pages
- **`FormHeader mode="detail"`** — large header for view/detail pages with entity type label, title, status badge, and Actions dropdown
- **`FormFooter`** — footer wrapping `FormActionButtons`
- **`ActionsDropdown`** — groups additional context actions (Convert, Send, Print). Delete is never inside the dropdown.

### Dialogs

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

// Dialog forms MUST use embedded={true}
<CrudForm fields={fields} onSubmit={handleSubmit} embedded={true} submitLabel="Save" />
```

### Detail Pages

```tsx
import { DetailFieldsSection, LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { NotesSection } from '@open-mercato/ui/backend/detail/NotesSection'
import { TagsSection } from '@open-mercato/ui/backend/detail/TagsSection'
import { CustomDataSection } from '@open-mercato/ui/backend/detail/CustomDataSection'
```

### Notifications

```tsx
import { flash } from '@open-mercato/ui/backend/FlashMessages'

flash('Record saved successfully', 'success')
flash('Failed to save record', 'error')
flash('This action cannot be undone', 'warning')
```

NEVER use `alert()`, `console.log()`, or custom toast implementations.

### Loading & Error States

```tsx
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
```

### Primitives

```tsx
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
```

## API Integration

```tsx
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

const handleCreate = async (values: FormValues) => {
  const result = await createCrud<ResponseType>('module/resource', values)
  if (result.ok) {
    flash('Created successfully', 'success')
    router.push(`/backend/module/${result.result.id}`)
  }
  return result
}
```

## Custom Fields Integration

```tsx
import { useCustomFieldDefinitions } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { buildCustomFieldFormFields } from '@open-mercato/ui/backend/utils/customFieldForms'
import { buildCustomFieldColumns } from '@open-mercato/ui/backend/utils/customFieldColumns'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
```

## Implementation Checklist

- [ ] Forms use `CrudForm` (not custom)
- [ ] Tables use `DataTable` (not custom)
- [ ] Notifications use `flash()` (not alert/toast)
- [ ] Dialog forms have `embedded={true}`
- [ ] Keyboard: `Cmd/Ctrl+Enter` (submit), `Escape` (cancel)
- [ ] Loading states use `LoadingMessage` or `DataLoader`
- [ ] Error states use `ErrorMessage`, `ErrorNotice`, or `Notice variant="error"`
- [ ] Empty states use `EmptyState`
- [ ] Column truncation uses `meta.truncate` and `meta.maxWidth`
- [ ] Boolean values use `BooleanIcon`
- [ ] Status/enum values use `EnumBadge`
- [ ] Row actions use `RowActions` with stable `id` values
- [ ] API calls use `apiCall`/`apiCallOrThrow` (not raw `fetch`)

## Anti-Patterns

1. Custom form implementations — use `CrudForm`
2. Manual table markup — use `DataTable`
3. Custom toast/notification — use `flash()`
4. Inline styles — use Tailwind classes
5. Hardcoded colors — use theme variables
6. Missing loading states — every async operation needs feedback
7. Missing error handling — every failure needs messaging
8. Missing keyboard shortcuts — all dialogs need `Cmd+Enter` and `Escape`
9. Custom truncation — use `TruncatedCell` with `meta.maxWidth`
10. Direct `fetch()` — use `apiCall`/`apiCallOrThrow`

## Visual Guidelines

### Spacing
- `p-4` for cards, `p-6` for page sections
- `gap-4` or `gap-6` for flex/grid layouts
- `space-y-4` or `space-y-6` for vertical rhythm

### Colors
- Use semantic colors from theme (no hardcoded hex)
- Destructive: `variant="destructive"` on buttons
- Status badges: `useSeverityPreset()`

### Layout Patterns
- **List pages**: FilterBar + DataTable + Pagination
- **Detail pages**: Header + Tabs/Sections + Related data
- **Create/Edit**: Full-page CrudForm or Dialog with embedded CrudForm
- **Settings**: Grouped sections with inline editing
