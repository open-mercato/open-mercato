# Widget Injection — Fields & Columns

## Fields

**Purpose**: Add an editable field to another module's CrudForm.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

### Template

```typescript
import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const widget: InjectionFieldWidget = {
  metadata: { id: '<your-module>.injection.<field-name>', priority: 50 },
  fields: [
    {
      id: '_<your-module>.<fieldName>',  // Matches enricher namespace
      label: '<your-module>.fields.<fieldName>',  // i18n key
      type: 'select',  // text | textarea | number | select | checkbox | date | custom
      group: 'details',  // Target group in CrudForm
      options: [
        { value: 'option1', label: '<your-module>.options.option1' },
        { value: 'option2', label: '<your-module>.options.option2' },
      ],
    },
  ],
  eventHandlers: {
    onSave: async (data, context) => {
      const resourceId = (context as Record<string, unknown>).resourceId as string
      const value = (data as Record<string, unknown>)['_<your-module>.<fieldName>']

      // Upsert pattern — idempotent save
      const existing = await readApiResultOrThrow<{ items: Array<{ id: string }> }>(
        `/api/<your-module>/resource?foreignId=${resourceId}`,
      )
      if (existing?.items?.[0]?.id) {
        await readApiResultOrThrow(`/api/<your-module>/resource`, {
          method: 'PUT',
          body: JSON.stringify({ id: existing.items[0].id, foreignId: resourceId, value }),
        })
      } else {
        await readApiResultOrThrow(`/api/<your-module>/resource`, {
          method: 'POST',
          body: JSON.stringify({ foreignId: resourceId, value }),
        })
      }
    },
  },
}

export default widget
```

### Rules

- Field `id` MUST match the enricher namespace path (e.g., `_example.priority`)
- `onSave` endpoints MUST be idempotent (use upsert pattern)
- Widget `onSave` fires BEFORE the core form save — design for partial failure
- Always use i18n keys for `label` and option labels — never hardcode strings
- The field reads its initial value from the enriched API response automatically

## Columns

**Purpose**: Add a column to another module's DataTable.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

### Template

```typescript
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionColumnWidget = {
  metadata: { id: '<your-module>.injection.<column-name>', priority: 40 },
  columns: [
    {
      id: '<your-module>_<fieldName>',
      header: '<your-module>.columns.<fieldName>',  // i18n key
      accessorKey: '_<your-module>.<fieldName>',     // Path to enriched data
      sortable: false,  // MUST be false for enriched-only fields
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' ? value : '—'
      },
    },
  ],
}

export default widget
```

### Rules

- `accessorKey` MUST point to enriched field path (e.g., `_example.priority`)
- `sortable` MUST be `false` for enriched-only fields (not in database index)
- Requires a matching Response Enricher that provides the data (Triad Pattern — [`triad-pattern.md`](triad-pattern.md))
