# Widget Injection — Filters

**Purpose**: Add a filter control to another module's DataTable filter bar.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

## Template

```typescript
import type { InjectionFilterWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionFilterWidget = {
  metadata: { id: '<your-module>.injection.<filter-name>', priority: 35 },
  filters: [
    {
      id: '<your-module><FilterName>',
      label: '<your-module>.filters.<filterName>',  // i18n key
      type: 'select',  // select | text | date | dateRange | boolean
      strategy: 'server',  // 'server' = sent as query param, 'client' = filtered locally
      queryParam: '<your-module><FilterName>',
      options: [
        { value: 'value1', label: '<your-module>.options.value1' },
        { value: 'value2', label: '<your-module>.options.value2' },
      ],
    },
  ],
}

export default widget
```

## Server-Side Filtering

When `strategy: 'server'`, the filter value is sent as a query parameter. You need an **API Interceptor** to process it:

```typescript
// api/interceptors.ts
const filterInterceptor: ApiInterceptor = {
  id: '<your-module>.filter-by-<filterName>',
  targetRoute: '<target-module>/<entities>',  // e.g., 'customers/people'
  methods: ['GET'],
  priority: 50,
  async before(request, context) {
    const filterValue = request.query?.['<your-module><FilterName>']
    if (!filterValue) return { ok: true }

    // Query your data to find matching target IDs
    const em = context.em as EntityManager
    const matches = await em.find(YourEntity, {
      fieldName: filterValue,
      organizationId: context.organizationId,
    })
    const matchingIds = matches.map(m => m.foreignId)

    if (matchingIds.length === 0) {
      return { ok: true, query: { ...request.query, ids: 'NONE' } }
    }

    // Narrow results by rewriting the ids query parameter
    const existingIds = request.query?.ids as string | undefined
    const narrowedIds = existingIds
      ? matchingIds.filter(id => existingIds.split(',').includes(id))
      : matchingIds
    return { ok: true, query: { ...request.query, ids: narrowedIds.join(',') } }
  },
}
```

## Rules

- Server filters require a matching API Interceptor to handle the `queryParam`
- Prefer `ids` query narrowing over post-filtering response arrays
- Return `ids: 'NONE'` to return empty results when no matches found
