# Widget Injection — Row Actions, Bulk Actions & Tabs

**Purpose**: Add context menu actions or bulk operations to another module's DataTable, or add a tab/section to a detail page.

## Row Action Template

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

```typescript
import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

const widget: InjectionRowActionWidget = {
  metadata: { id: '<your-module>.injection.<action-name>', priority: 30 },
  rowActions: [
    {
      id: '<your-module>.<entity>.<action>',
      label: '<your-module>.actions.<actionName>',  // i18n key
      icon: 'CheckSquare',  // Lucide icon name
      features: ['<your-module>.<action>'],  // ACL gating
      placement: { position: InjectionPosition.After, relativeTo: 'edit' },
      onSelect: (row, context) => {
        const id = (row as Record<string, unknown>).id as string
        const navigate = (context as { navigate?: (path: string) => void }).navigate
        navigate?.(`/backend/<your-module>/resource/${id}`)
      },
    },
  ],
}

export default widget
```

## Bulk Action Template

```typescript
import type { InjectionBulkActionWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionBulkActionWidget = {
  metadata: { id: '<your-module>.injection.bulk-<action-name>', priority: 30 },
  bulkActions: [
    {
      id: '<your-module>.bulk.<action>',
      label: '<your-module>.actions.bulk<ActionName>',
      features: ['<your-module>.<action>'],
      onExecute: async (selectedRows, context) => {
        const ids = selectedRows.map(r => (r as Record<string, unknown>).id)
        await readApiResultOrThrow(`/api/<your-module>/bulk-action`, {
          method: 'POST',
          body: JSON.stringify({ targetIds: ids }),
        })
        ;(context as { refresh?: () => void }).refresh?.()
      },
    },
  ],
}

export default widget
```

## Tab Widget Template (Detail Pages)

```typescript
import type { InjectionWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionWidget = {
  metadata: { id: '<your-module>.injection.<tab-name>', priority: 40 },
  component: () => import('./widget.client'),
}

export default widget
```

Then create the client component at `widget.client.tsx`:

```tsx
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function MyTabContent({ context }: { context: Record<string, unknown> }) {
  const t = useT()
  const resourceId = context.resourceId as string
  // Fetch and display your data
  return <div>...</div>
}
```

## Rules

- Use `InjectionPosition` for relative placement — never hardcode positions
- Always set `features` for ACL-gated actions
- Row action `id` must be stable for integration testing
- Bulk action `onExecute` should call `refresh()` after mutation
