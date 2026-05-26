# UI Components Reference

Complete reference of all available UI components in `@open-mercato/ui`.

## Package Structure

```
@open-mercato/ui/
├── primitives/          # Base UI components (shadcn-style)
├── backend/             # Full-featured admin components
├── frontend/            # Public-facing components
└── theme/               # Theme and provider setup
```

## PRIMITIVES (`@open-mercato/ui/primitives/*`)

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
| **DataTable** | `@open-mercato/ui/backend/DataTable` | Feature-rich table with sorting, filtering, pagination, export, perspectives | `entityId`, `apiPath`, `extensionTableId`, `columns`, `data`, `page`, `pageSize`, `totalCount`, `onPageChange`, `onRowClick` |
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

Specialized inputs that ship with the framework. For each, the full props table, MUST rules, and anti-patterns live in `.ai/ui-components.md` under the section linked from the component name.

| Component | Import Path | Purpose | Key Props |
|-----------|-------------|---------|-----------|
| **ComboboxInput** | `@open-mercato/ui/backend/inputs/ComboboxInput` | Single-value typeahead with sync/async suggestions; allows free-form custom values by default | `value`, `onChange`, `suggestions`, `loadSuggestions`, `resolveLabel`, `allowCustomValues` |
| **TagsInput** | `@open-mercato/ui/backend/inputs/TagsInput` | Multi-value (`string[]`) version of `ComboboxInput` with rich `{ value, label, description }` triples | `value`, `onChange`, `suggestions`, `loadSuggestions`, `selectedOptions`, `resolveLabel` |
| **LookupSelect** | `@open-mercato/ui/backend/inputs/LookupSelect` | Rich card-list search/select with title/subtitle/icon/badge per row; returns selected id | `value`, `onChange`, `fetchItems`, `options`, `minQuery`, `actionSlot` |
| **PhoneNumberField** | `@open-mercato/ui/backend/inputs/PhoneNumberField` | Compound country-picker + national-number input matching Figma `Text Input [1.1]` Phone variant. Validates + normalizes on blur, optional duplicate lookup | `value`, `onValueChange`, `onDigitsChange`, `countries`, `defaultCountryIso2`, `onDuplicateLookup` |
| **EventSelect** | `@open-mercato/ui/backend/inputs/EventSelect` | Strict select for declared platform events, grouped by module. **Mandated by `packages/ui/AGENTS.md`** for event selection | `value`, `onChange`, `categories`, `modules`, `excludeTriggerExcluded`, `size` |
| **EventPatternInput** | `@open-mercato/ui/backend/inputs/EventPatternInput` | `ComboboxInput` preloaded with declared events that allows wildcard patterns (e.g. `sales.orders.*`) | `value`, `onChange`, `categories`, `modules` |
| **TimeInput** | `@open-mercato/ui/backend/inputs/TimeInput` | Bare `HH:MM` editor (two `<input type="number">` cells, no popover). Low-level atom — most flows want `TimePicker` | `value`, `onChange`, `minuteStep`, `hourLabel`, `minuteLabel` |
| **DatePicker** *(@deprecated shim — import from `primitives/date-picker`)* | `@open-mercato/ui/backend/inputs/DatePicker` | Backward-compat re-export of the `DatePicker` primitive. New code MUST import from `@open-mercato/ui/primitives/date-picker`. | — |
| **DateTimePicker** *(@deprecated shim — use `DatePicker withTime`)* | `@open-mercato/ui/backend/inputs/DateTimePicker` | Thin wrapper that always sets `withTime` on the primitive. New code: `<DatePicker withTime />` | — |
| **TimePicker** *(@deprecated shim — import from `primitives/time-picker`)* | `@open-mercato/ui/backend/inputs/TimePicker` | Legacy popover-anchored time picker wrapping the new `TimePicker` primitive. New code: `@open-mercato/ui/primitives/time-picker`. | — |
| **SwitchableMarkdownInput** *(@deprecated — use `RichEditor`)* | `@open-mercato/ui/backend/inputs/SwitchableMarkdownInput` | Markdown ⇄ plain textarea toggle. Kept only for backward compatibility with Markdown-backed surfaces. New rich-text fields MUST use `RichEditor` from `@open-mercato/ui/primitives/rich-editor` (sanitized HTML). | `value`, `onChange`, `isMarkdownEnabled` |

### Input Variants (Figma `Text Input [1.1]` — `@open-mercato/ui/primitives/*`)

Foundation-level input variants matching Figma type-specific designs. Use these instead of raw `<Input type="email">`, `<Input type="password">`, etc. — they ship correct visual chrome (leading icons, prefix boxes, trailing buttons, brand badges) and i18n-resolved labels.

| Component | Import Path | Purpose | Key Props |
|-----------|-------------|---------|-----------|
| **EmailInput** | `@open-mercato/ui/primitives/email-input` | `Input` wrapper with leading Mail icon, `type="email"`, `autoComplete="email"` | `value`, `onChange`, `showIcon` |
| **SearchInput** | `@open-mercato/ui/primitives/search-input` | Leading Search icon + trailing × clear button (when value non-empty). Use for DataTable global filter, command palette, list-view live filter | `value`, `onChange`, `onClear`, `clearable` |
| **PasswordInput** | `@open-mercato/ui/primitives/password-input` | Leading Lock icon + trailing Eye/EyeOff reveal toggle. Controlled or uncontrolled reveal state | `value`, `onChange`, `revealable`, `revealed`, `onRevealedChange`, `showLockIcon` |
| **WebsiteInput** | `@open-mercato/ui/primitives/website-input` | Left "https://" prefix box + divider + URL input. `type="url"` | `value`, `onChange`, `prefix`, `showPrefix` |
| **AmountInput** | `@open-mercato/ui/primitives/amount-input` | Leading currency symbol + numeric input + trailing ISO currency picker (10 markets default) | `value: { amount, currency }`, `onChange`, `currencies`, `showCurrency` |
| **ButtonInput** | `@open-mercato/ui/primitives/button-input` | Input with optional `leftIcon` + divider + required `trailingAction` slot for interactive button (copy URL, send, regenerate) | `leftIcon`, `trailingAction` (required) |
| **CardInput** | `@open-mercato/ui/primitives/card-input` | Credit-card-number input with regex-based brand auto-detection (Visa/MC/Amex/Discover/Diners/JCB/UnionPay), format masking, brand badge | `value` (digits-only), `onChange`, `onBrandChange`, `brands` |

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

## Common Usage Patterns

### Flash Messages
```tsx
import { flash } from '@open-mercato/ui/backend/FlashMessages'

flash('Record saved successfully', 'success')
flash('Failed to save record', 'error')
// Types: 'success' | 'error' | 'warning' | 'info'
```

### DataTable with Filters
```tsx
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

const filters: FilterDef[] = [
  { id: 'search', type: 'text', label: 'Search', placeholder: 'Search...' },
  { id: 'status', type: 'select', label: 'Status', options: [...] },
]

<DataTable
  entityId="inventory.item"
  apiPath="inventory/items"
  extensionTableId="inventory.item"
  columns={columns}
  filters={filters}
  filterValues={filterValues}
  onFiltersApply={handleFiltersApply}
  onFiltersClear={handleFiltersClear}
  page={page}
  pageSize={pageSize}
  totalCount={totalCount}
  onPageChange={setPage}
  onRowClick={(row) => router.push(`/items/${row.id}`)}
/>
```

### CrudForm
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

### Dialog with Form
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

### Detail Page with Inline Editing
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

### API Calls
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

## Important Notes

1. **Always use `flash()` for notifications** - Don't use `alert()` or custom toast implementations
2. **Use `CrudForm` for forms** - Provides consistent validation, field rendering, and keyboard shortcuts
3. **Use `DataTable` for lists** - Includes filtering, sorting, pagination, export, and perspectives
4. **Keep `extensionTableId` stable** - Injection spots must remain backward-compatible
5. **Use `JsonBuilder` for JSON editing** - Provides both raw JSON and visual builder modes
6. **Dialog forms need `embedded={true}`** - And add `[&_.grid]:!grid-cols-1` to DialogContent for single-column layout
7. **Support Cmd/Ctrl+Enter and Escape** - All dialogs should support these keyboard shortcuts
