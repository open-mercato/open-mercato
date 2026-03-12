# UI Package — Standalone Developer Guide

`@open-mercato/ui` provides all admin/backend UI components. Use these instead of building from scratch.

## Key Imports

```typescript
// Buttons (MUST use — never raw <button>)
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

// CRUD forms
import { CrudForm, createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

// API calls (MUST use — never raw fetch)
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

// Page structure
import { FormHeader, FormFooter } from '@open-mercato/ui/backend/forms'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

// Widget injection
import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'
import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'
import { mergeMenuItems } from '@open-mercato/ui/backend/injection/mergeMenuItems'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

// Real-time events
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useOperationProgress } from '@open-mercato/ui/backend/injection/useOperationProgress'

// Custom fields
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
```

## MUST Rules

1. **MUST use `Button`/`IconButton`** — never raw `<button>` elements
2. **MUST pass `type="button"` explicitly** on non-submit buttons (HTML defaults to `type="submit"`)
3. **MUST use `apiCall`/`apiCallOrThrow`** — never raw `fetch`
4. **MUST use `LoadingMessage`/`ErrorMessage`** for loading/error states
5. **MUST NOT hard-code user-facing strings** — use `useT()` for all labels
6. **Every dialog**: `Cmd/Ctrl+Enter` to submit, `Escape` to cancel
7. **Keep `pageSize`** at or below 100

## CrudForm — Create/Edit Flows

Default for all create/edit pages and dialog forms:

```tsx
<CrudForm
  entityId="my_module:my_entity"
  mode="create" // or "edit"
  fields={fields}
  groups={groups}
  onSubmit={async (data) => {
    await createCrud('/api/my-module/items', data)
    flash(t('my_module.created'), 'success')
  }}
/>
```

- Drive validation with Zod schemas; surface errors via `createCrudFormError(message, fieldErrors?)`
- Pass `entityIds` when custom fields are involved
- Use `createCrud`/`updateCrud`/`deleteCrud` for submit actions
- Keep fields and groups in memoized helpers

## Non-CrudForm Write Operations

When a page can't use `CrudForm`, wrap every write in `useGuardedMutation`:

```typescript
const { runMutation } = useGuardedMutation()
await runMutation({ operation: 'update', context: { entityId, recordId }, mutationPayload: data })
```

## DataTable — List Views

```tsx
<DataTable
  columns={columns}
  data={items}
  extensionTableId="my-module-items" // stable ID for widget injection
  rowClickActionIds={['edit', 'open']} // default
/>
```

- Set `meta.truncate` and `meta.maxWidth` on columns for truncation
- Use `FilterBar`/`FilterOverlay` with async option loaders
- Use stable `extensionTableId` — widget injection spots depend on it
- Extension spots: `data-table:<tableId>:columns`, `:row-actions`, `:bulk-actions`, `:filters`

## Buttons — Quick Reference

| Use case | Component | Example |
|----------|-----------|---------|
| Button with text | `Button` | Save, Cancel, Create |
| Icon-only button | `IconButton` | Close, Settings, Trash |
| Link as button | `IconButton asChild` | `<IconButton asChild><Link href="...">...</Link></IconButton>` |

**Button variants**: `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link`
**IconButton variants**: `outline` (default), `ghost`

## FormHeader Modes

```tsx
// Edit mode (compact, used by CrudForm)
<FormHeader mode="edit" title="Edit Item" />

// Detail mode (large title with status badge)
<FormHeader mode="detail" title="Item #123" entityTypeLabel="Item" statusBadge={<Badge>Active</Badge>} menuActions={[...]} />
```

## Menu Injection

Load and merge injected menu items for sidebar/topbar surfaces:

```typescript
const injectedItems = useInjectedMenuItems('menu:sidebar:main')
const merged = mergeMenuItems(builtInItems, injectedItems)
```

Use `InjectionPosition` + `relativeTo` for deterministic placement.

## Real-Time Events

```typescript
// Subscribe to server events (via DOM Event Bridge)
useAppEvent('my_module.entity.*', (event) => {
  // event.id, event.payload — refresh data, show notifications
}, [dependencies])

// Track long-running operations
const progress = useOperationProgress('my_module.import.*')
// progress.status, progress.progress (0-100), progress.processedCount
```

## Flash Messages

```typescript
flash(t('my_module.saved'), 'success')
flash(t('my_module.error'), 'error')
```

## Component Replacement

For replacement-aware surfaces, resolve components by handle:

```typescript
const MyComponent = useRegisteredComponent('page:my-module:detail', DefaultDetailPage)
return <MyComponent {...props} />
```
