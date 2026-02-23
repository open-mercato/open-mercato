# UI Components Documentation for Claude Code

This document provides a comprehensive reference of all available UI components in `@open-mercato/ui`. Use these common components when building UI instead of creating custom implementations.

---

## Package Structure

```
@open-mercato/ui/
├── primitives/          # Base UI components (shadcn-style)
├── backend/             # Full-featured admin components
├── frontend/            # Public-facing components
└── theme/               # Theme and provider setup
```

---

## PRIMITIVES (`@open-mercato/ui/primitives/*`)

Base, reusable UI building blocks:

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **Button** | `@open-mercato/ui/primitives/button` | Core button with variants (default, outline, ghost, destructive) |
| **Input** | `@open-mercato/ui/primitives/input` | Text input field |
| **Label** | `@open-mercato/ui/primitives/label` | Form label component |
| **Textarea** | `@open-mercato/ui/primitives/textarea` | Multi-line text input |
| **Dialog** | `@open-mercato/ui/primitives/dialog` | Modal dialog (Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter) |
| **Tooltip** | `@open-mercato/ui/primitives/tooltip` | Hover tooltip + `SimpleTooltip` utility component |
| **Table** | `@open-mercato/ui/primitives/table` | Table structure (Table, TableHeader, TableBody, TableRow, TableHead, TableCell) |
| **Alert** | `@open-mercato/ui/primitives/alert` | Alert boxes (Alert, AlertTitle, AlertDescription) with variants |
| **Badge** | `@open-mercato/ui/primitives/badge` | Small badge/tag labels with variants |
| **Separator** | `@open-mercato/ui/primitives/separator` | Visual divider line |
| **Switch** | `@open-mercato/ui/primitives/switch` | Toggle switch control |
| **Spinner** | `@open-mercato/ui/primitives/spinner` | Loading spinner animation |
| **Notice** | `@open-mercato/ui/primitives/Notice` | Contextual notice/hint with variants (`error`, `info`, `warning`) and optional `compact` mode |
| **ErrorNotice** | `@open-mercato/ui/primitives/ErrorNotice` | Convenience wrapper around `<Notice variant="error">` with default title/message |
| **DataLoader** | `@open-mercato/ui/primitives/DataLoader` | Loading state wrapper with spinner and optional skeleton |
| **Popover** | `@open-mercato/ui/primitives/popover` | Radix popover (Popover, PopoverTrigger, PopoverContent) for dropdowns and overlays |
| **Calendar** | `@open-mercato/ui/primitives/calendar` | Calendar grid (react-day-picker) for date selection, locale-aware |

---

## BACKEND COMPONENTS (`@open-mercato/ui/backend/*`)

### Core Layout & Navigation

| Component | Import Path | Purpose | Key Props |
|-----------|-------------|---------|-----------|
| **AppShell** | `@open-mercato/ui/backend/AppShell` | Main application shell with sidebar, header, breadcrumbs | `navigation`, `user`, `children` |
| **Page, PageHeader, PageBody** | `@open-mercato/ui/backend/Page` | Page layout containers | - |
| **UserMenu** | `@open-mercato/ui/backend/UserMenu` | User profile dropdown with logout | `user`, `onLogout` |
| **FlashMessages, flash** | `@open-mercato/ui/backend/FlashMessages` | Toast notifications. Use `flash(message, type)` programmatically | Type: 'success' \| 'error' \| 'warning' \| 'info' |

### Data Display & Tables

| Component | Import Path | Purpose | Key Props |
|-----------|-------------|---------|-----------|
| **DataTable** | `@open-mercato/ui/backend/DataTable` | Feature-rich table with sorting, filtering, pagination, export, perspectives | `columns`, `data`, `filters`, `pagination`, `perspective`, `onRowClick` |
| **TruncatedCell** | `@open-mercato/ui/backend/TruncatedCell` | Table cell with text truncation and tooltip | `value`, `maxWidth` |
| **EmptyState** | `@open-mercato/ui/backend/EmptyState` | Empty state placeholder | `title`, `description`, `action`, `icon` |
| **RowActions** | `@open-mercato/ui/backend/RowActions` | Context menu for row actions | `items: {label, href?, onSelect?, destructive?}[]` |
| **FilterBar** | `@open-mercato/ui/backend/FilterBar` | Search and filter UI bar | `filters`, `values`, `onApply`, `onClear` |
| **ValueIcons** | `@open-mercato/ui/backend/ValueIcons` | `BooleanIcon`, `EnumBadge`, `useSeverityPreset()` | - |

### Forms

| Component | Import Path | Purpose | Key Props |
|-----------|-------------|---------|-----------|
| **CrudForm** | `@open-mercato/ui/backend/CrudForm` | Complete CRUD form with field registry, groups, custom fields, validation | `fields`, `groups`, `initialValues`, `onSubmit`, `schema`, `embedded`, `extraActions` |
| **FormHeader** | `@open-mercato/ui/backend/forms` | Unified page header with `edit` mode (compact, for CrudForm) and `detail` mode (large title, entity type label, status badge, Actions dropdown) | `mode`, `backHref`, `title`, `actions`, `menuActions`, `onDelete`, `statusBadge` |
| **FormFooter** | `@open-mercato/ui/backend/forms` | Form footer wrapping FormActionButtons with embedded/dialog layout awareness | `actions`, `embedded`, `className` |
| **FormActionButtons** | `@open-mercato/ui/backend/forms` | Atomic button bar: [extraActions] [Delete] [Cancel] [Save]. Shared by header and footer. | `showDelete`, `onDelete`, `cancelHref`, `submit` |
| **ActionsDropdown** | `@open-mercato/ui/backend/forms` | Dropdown menu for additional context actions (Convert, Send, Print). Only visible when items are provided. Delete is never inside the dropdown. | `items: ActionItem[]`, `label`, `size` |
| **JsonBuilder** | `@open-mercato/ui/backend/JsonBuilder` | Interactive JSON editor with "Raw JSON" and "Builder" tabs | `value`, `onChange`, `disabled` |
| **JsonDisplay** | `@open-mercato/ui/backend/JsonDisplay` | Read-only JSON viewer with expand/collapse | `data`, `title`, `maxInitialDepth`, `showCopy` |

### Input Components (`@open-mercato/ui/backend/inputs/*`)

| Component | Import Path | Purpose | Key Props |
|-----------|-------------|---------|-----------|
| **TagsInput** | `@open-mercato/ui/backend/inputs/TagsInput` | Multi-tag input with suggestions | `value`, `onChange`, `placeholder`, `suggestions` |
| **ComboboxInput** | `@open-mercato/ui/backend/inputs/ComboboxInput` | Searchable dropdown (single value) | `value`, `onChange`, `options`, `placeholder` |
| **PhoneNumberField** | `@open-mercato/ui/backend/inputs/PhoneNumberField` | Phone input with formatting | `value`, `onChange`, `checkDuplicate` |
| **LookupSelect** | `@open-mercato/ui/backend/inputs/LookupSelect` | Async lookup/search select | `value`, `onChange`, `onSearch`, `renderItem` |
| **SwitchableMarkdownInput** | `@open-mercato/ui/backend/inputs/SwitchableMarkdownInput` | Text/markdown toggle input | `value`, `onChange`, `placeholder` |
| **DatePicker** | `@open-mercato/ui/backend/inputs/DatePicker` | Date-only picker (popover + calendar), `Date \| null` | `value`, `onChange`, `minDate`, `maxDate`, `closeOnSelect`, `displayFormat` |
| **DateTimePicker** | `@open-mercato/ui/backend/inputs/DateTimePicker` | Date+time picker (popover + calendar + time spinners), `Date \| null` | `value`, `onChange`, `minDate`, `maxDate`, `minuteStep`, `displayFormat` |
| **TimePicker** | `@open-mercato/ui/backend/inputs/TimePicker` | Time-only picker (popover + hour:minute spinners), `string \| null` (HH:MM) | `value`, `onChange`, `minuteStep`, `showNowButton` |
| **TimeInput** | `@open-mercato/ui/backend/inputs/TimeInput` | Inline hour:minute spinners (no popover), for use in availability windows etc. | `value`, `onChange`, `minuteStep`, `hourLabel`, `minuteLabel` |

### Detail Page Components (`@open-mercato/ui/backend/detail/*`)

| Component | Import Path | Purpose | Key Props |
|-----------|-------------|---------|-----------|
| **DetailFieldsSection** | `@open-mercato/ui/backend/detail/DetailFieldsSection` | Entity field display with inline editing | `fields`, `entity`, `onUpdate` |
| **InlineTextEditor** | `@open-mercato/ui/backend/detail/InlineEditors` | Click-to-edit text field | `value`, `onSave`, `label` |
| **InlineMultilineEditor** | `@open-mercato/ui/backend/detail/InlineEditors` | Click-to-edit textarea | `value`, `onSave`, `label` |
| **InlineSelectEditor** | `@open-mercato/ui/backend/detail/InlineEditors` | Click-to-edit select | `value`, `onSave`, `options`, `label` |
| **NotesSection** | `@open-mercato/ui/backend/detail/NotesSection` | Notes/comments section with markdown | `notes`, `onAdd`, `onUpdate`, `onDelete` |
| **TagsSection** | `@open-mercato/ui/backend/detail/TagsSection` | Tag management section | `tags`, `onAdd`, `onRemove`, `suggestions` |
| **CustomDataSection** | `@open-mercato/ui/backend/detail/CustomDataSection` | Custom fields display | `data`, `fieldDefinitions` |
| **LoadingMessage** | `@open-mercato/ui/backend/detail` | Loading state with spinner | `message` |
| **ErrorMessage** | `@open-mercato/ui/backend/detail` | Error alert with action | `title`, `description`, `action` |
| **TabEmptyState** | `@open-mercato/ui/backend/detail` | Empty state for tabs | `message`, `action` |

### Custom Fields (`@open-mercato/ui/backend/custom-fields/*`)

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **FieldDefinitionsManager** | `@open-mercato/ui/backend/custom-fields/FieldDefinitionsManager` | Manager for custom field definitions CRUD |
| **FieldDefinitionsEditor** | `@open-mercato/ui/backend/custom-fields/FieldDefinitionsEditor` | Editor UI for field definitions |

### Schedule Components (`@open-mercato/ui/backend/schedule/*`)

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **ScheduleView** | `@open-mercato/ui/backend/schedule/ScheduleView` | Main calendar view (react-big-calendar) |
| **ScheduleGrid** | `@open-mercato/ui/backend/schedule/ScheduleGrid` | Grid-based day/week view |
| **ScheduleAgenda** | `@open-mercato/ui/backend/schedule/ScheduleAgenda` | Agenda list view |
| **ScheduleToolbar** | `@open-mercato/ui/backend/schedule/ScheduleToolbar` | Date navigation and view selector |

### Widget Injection (`@open-mercato/ui/backend/injection/*`)

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **InjectionSpot** | `@open-mercato/ui/backend/injection/InjectionSpot` | Render point for injected widgets |
| **PageInjectionBoundary** | `@open-mercato/ui/backend/injection/PageInjectionBoundary` | Page wrapper with before/after injection |

### Dashboard (`@open-mercato/ui/backend/dashboard/*`)

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **DashboardScreen** | `@open-mercato/ui/backend/dashboard/DashboardScreen` | Customizable widget dashboard |

### System Banners

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **LastOperationBanner** | `@open-mercato/ui/backend/operations/LastOperationBanner` | Undo banner for recent operations |
| **UpgradeActionBanner** | `@open-mercato/ui/backend/upgrades/UpgradeActionBanner` | Upgrade/migration prompts |
| **PartialIndexBanner** | `@open-mercato/ui/backend/indexes/PartialIndexBanner` | Incomplete index warning |

### Other Backend Components

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **ContextHelp** | `@open-mercato/ui/backend/ContextHelp` | Collapsible help section |
| **ConfirmDialog** | `@open-mercato/ui/backend/ConfirmDialog` | Confirmation wrapper |

---

## BACKEND UTILITIES (`@open-mercato/ui/backend/utils/*`)

| Utility | Import Path | Purpose | Key Exports |
|---------|-------------|---------|-------------|
| **apiCall** | `@open-mercato/ui/backend/utils/apiCall` | HTTP client with auth | `apiCall`, `apiCallOrThrow`, `readApiResultOrThrow` |
| **api** | `@open-mercato/ui/backend/utils/api` | Low-level API utils | `apiFetch` |
| **crud** | `@open-mercato/ui/backend/utils/crud` | CRUD operation helpers | `createCrud`, `updateCrud`, `deleteCrud` |
| **serverErrors** | `@open-mercato/ui/backend/utils/serverErrors` | Error mapping | `mapCrudServerErrorToFormErrors`, `createCrudFormError`, `raiseCrudError` |
| **customFieldValues** | `@open-mercato/ui/backend/utils/customFieldValues` | Custom field value helpers | `collectCustomFieldValues`, `normalizeCustomFieldSubmitValue` |
| **customFieldDefs** | `@open-mercato/ui/backend/utils/customFieldDefs` | Field definition fetching | `useCustomFieldDefinitions` |
| **customFieldForms** | `@open-mercato/ui/backend/utils/customFieldForms` | Form field generation | `buildCustomFieldFormFields` |
| **customFieldColumns** | `@open-mercato/ui/backend/utils/customFieldColumns` | Column builders | `buildCustomFieldColumns` |
| **customFieldFilters** | `@open-mercato/ui/backend/utils/customFieldFilters` | Filter definitions | `useCustomFieldFilters` |

---

## FRONTEND COMPONENTS (`@open-mercato/ui/frontend/*`)

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **FrontendLayout** | `@open-mercato/ui/frontend/Layout` | Basic layout with header/footer |
| **AuthFooter** | `@open-mercato/ui/frontend/AuthFooter` | Footer for auth pages |
| **LanguageSwitcher** | `@open-mercato/ui/frontend/LanguageSwitcher` | Language selection dropdown |

---

## THEME & PROVIDERS

| Component | Import Path | Purpose |
|-----------|-------------|---------|
| **ThemeProvider** | `@open-mercato/ui/theme/ThemeProvider` | Theme context and CSS variables |
| **QueryProvider** | `@open-mercato/ui/theme/QueryProvider` | TanStack Query provider |

---

## Common Usage Patterns

### 1. Flash Messages
```tsx
import { flash } from '@open-mercato/ui/backend/FlashMessages'

// Show success message
flash('Record saved successfully', 'success')

// Show error message
flash('Failed to save record', 'error')

// Types: 'success' | 'error' | 'warning' | 'info'
```

### 2. DataTable with Filters
```tsx
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

const filters: FilterDef[] = [
  { id: 'search', type: 'text', label: 'Search', placeholder: 'Search...' },
  { id: 'status', type: 'select', label: 'Status', options: [...] },
]

<DataTable
  title="Items"
  columns={columns}
  data={data}
  filters={filters}
  filterValues={filterValues}
  onFiltersApply={handleFiltersApply}
  onFiltersClear={handleFiltersClear}
  pagination={{ page, pageSize, total, totalPages, onPageChange }}
  onRowClick={(row) => router.push(`/items/${row.id}`)}
/>
```

### 3. CrudForm
```tsx
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true },
  { id: 'description', label: 'Description', type: 'textarea' },
  { id: 'status', label: 'Status', type: 'select', options: [...] },
  { id: 'config', label: 'Config', type: 'custom', component: (props) => <JsonBuilder {...props} /> },
]

const groups: CrudFormGroup[] = [
  { id: 'basic', title: 'Basic Info', column: 1, fields: ['name', 'description'] },
  { id: 'settings', title: 'Settings', column: 1, fields: ['status', 'config'] },
]

<CrudForm
  title="Create Item"
  fields={fields}
  groups={groups}
  initialValues={{}}
  onSubmit={handleSubmit}
  submitLabel="Save"
  embedded={true}  // For use inside dialogs
  extraActions={<Button onClick={handleDelete}>Delete</Button>}
/>
```

### 4. Dialog with Form
```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'

<Dialog open={isOpen} onOpenChange={onClose}>
  <DialogContent className="sm:max-w-2xl [&_.grid]:!grid-cols-1">
    <DialogHeader>
      <DialogTitle>Edit Item</DialogTitle>
    </DialogHeader>
    <CrudForm
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      onSubmit={handleSubmit}
      embedded={true}
      submitLabel="Save"
    />
  </DialogContent>
</Dialog>
```

### 5. JsonBuilder for JSON Fields
```tsx
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'

// As standalone component
<JsonBuilder
  value={config}
  onChange={setConfig}
  disabled={false}
/>

// As CrudForm custom field
{
  id: 'config',
  label: 'Configuration (JSON)',
  type: 'custom',
  component: (props) => (
    <JsonBuilder
      value={props.value || {}}
      onChange={props.setValue}
      disabled={props.disabled}
    />
  ),
}
```

### 6. Detail Page with Inline Editing
```tsx
import { DetailFieldsSection, LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'

if (isLoading) return <LoadingMessage message="Loading..." />
if (error) return <ErrorMessage title="Error" description={error.message} />

<DetailFieldsSection
  fields={[
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'status', label: 'Status', type: 'select', options: [...] },
  ]}
  entity={entity}
  onUpdate={handleUpdate}
/>
```

### 7. FormHeader (Detail Page)
```tsx
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ArrowRightLeft, Send } from 'lucide-react'

// Detail mode -- large title, entity type label, status badge, Actions dropdown
<FormHeader
  mode="detail"
  backHref="/backend/sales/quotes"
  backLabel="Back to quotes"
  entityTypeLabel="Sales quote"
  title={<InlineTextEditor value={number} onSave={handleSave} />}
  statusBadge={<Badge variant="secondary">Sent</Badge>}
  menuActions={[
    { id: 'convert', label: 'Convert to order', icon: ArrowRightLeft, onSelect: handleConvert },
    { id: 'send', label: 'Send to customer', icon: Send, onSelect: handleSend },
  ]}
  onDelete={handleDelete}
  isDeleting={deleting}
/>

// Edit mode -- compact, used automatically by CrudForm (no manual usage needed)
<FormHeader
  mode="edit"
  backHref="/backend/catalog/categories"
  title="Edit category"
  actions={{
    showDelete: true,
    onDelete: handleDelete,
    cancelHref: '/backend/catalog/categories',
    submit: { pending: isSaving, label: 'Save' },
  }}
/>
```

### 8. API Calls
```tsx
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'

// Generic API call
const result = await apiCall<ResponseType>('/api/endpoint', { method: 'POST', body: JSON.stringify(data) })
if (result.ok) {
  // result.result contains the parsed JSON response
}

// CRUD operations
const created = await createCrud<ItemType>('module/items', payload)
const updated = await updateCrud<ItemType>('module/items', id, payload)
const deleted = await deleteCrud('module/items', id)
```

---

## Important Notes

1. **Always use `flash()` for notifications** - Don't use `alert()` or custom toast implementations
2. **Use `CrudForm` for forms** - Provides consistent validation, field rendering, and keyboard shortcuts
3. **Use `DataTable` for lists** - Includes filtering, sorting, pagination, export, and perspectives
4. **Use `JsonBuilder` for JSON editing** - Provides both raw JSON and visual builder modes
5. **Dialog forms need `embedded={true}`** - And add `[&_.grid]:!grid-cols-1` to DialogContent for single-column layout
6. **Support Cmd/Ctrl+Enter and Escape** - All dialogs should support these keyboard shortcuts
7. **Use `FormHeader` for page headers** - Edit mode (compact) for CrudForm pages, detail mode (large title + status + Actions dropdown) for view pages. Never build inline header layouts manually.
8. **Use `FormFooter` for form footers** - Wraps `FormActionButtons` with embedded/dialog awareness. Delete/Cancel/Save are always standalone buttons, never inside a dropdown.

---

## Changelog

| Date | Summary |
|------|---------|
| 2026-02-23 | Added Popover, Calendar (primitives); DatePicker, DateTimePicker, TimePicker, TimeInput (inputs). Per [SPEC-034](SPEC-034-2026-02-22-date-pickers.md). |
