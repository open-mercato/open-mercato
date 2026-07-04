# The Triad Pattern

When extending another module's UI with data from your module, you need three coordinated pieces:

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  1. ENRICHER    │────▶│  2. WIDGET       │────▶│  3. INJECTION     │
│  (data/         │     │  (widgets/       │     │     TABLE         │
│   enrichers.ts) │     │   injection/     │     │  (widgets/        │
│                 │     │   <name>/        │     │   injection-      │
│  Adds _<module> │     │   widget.ts)     │     │   table.ts)       │
│  fields to API  │     │                  │     │                   │
│  response       │     │  Renders the     │     │  Maps widget to   │
│                 │     │  enriched data   │     │  target spot ID   │
└─────────────────┘     └──────────────────┘     └───────────────────┘
```

## Example: Add "Priority" field to Customers form

**Step 1 — Enricher** (`data/enrichers.ts`):
```typescript
const enricher: ResponseEnricher = {
  id: 'priorities.customer-priority',
  targetEntity: 'customers.person',
  priority: 50,
  async enrichOne(record, context) {
    const priority = await em.findOne(CustomerPriority, { customerId: record.id })
    return { ...record, _priorities: { level: priority?.level ?? 'normal' } }
  },
  async enrichMany(records, context) {
    const items = await em.find(CustomerPriority, { customerId: { $in: records.map(r => r.id) } })
    const byId = new Map(items.map(i => [i.customerId, i.level]))
    return records.map(r => ({ ...r, _priorities: { level: byId.get(r.id) ?? 'normal' } }))
  },
}
export const enrichers = [enricher]
```

**Step 2 — Field Widget** (`widgets/injection/customer-priority-field/widget.ts`):
```typescript
const widget: InjectionFieldWidget = {
  metadata: { id: 'priorities.injection.customer-priority-field', priority: 50 },
  fields: [{
    id: '_priorities.level',
    label: 'priorities.fields.level',
    type: 'select',
    group: 'details',
    options: [
      { value: 'low', label: 'priorities.options.low' },
      { value: 'normal', label: 'priorities.options.normal' },
      { value: 'high', label: 'priorities.options.high' },
    ],
  }],
  eventHandlers: {
    onSave: async (data, context) => {
      const customerId = (context as any).resourceId
      const level = (data as any)['_priorities.level']
      await readApiResultOrThrow('/api/priorities/customer-priorities', {
        method: 'POST',
        body: JSON.stringify({ customerId, level }),
      })
    },
  },
}
export default widget
```

**Step 3 — Injection Table** (`widgets/injection-table.ts`):
```typescript
export const widgetInjections = {
  'crud-form:customers.person:fields': {
    widgetId: 'priorities.injection.customer-priority-field',
    priority: 50,
  },
}
```

**Step 4 — Run `yarn generate`** to wire everything up.

## Triad for Columns

Same pattern but with Column Widget instead of Field Widget:

| Spot ID Pattern | Widget Type |
|----------------|-------------|
| `crud-form:<entityId>:fields` | `InjectionFieldWidget` |
| `data-table:<tableId>:columns` | `InjectionColumnWidget` |
| `data-table:<tableId>:row-actions` | `InjectionRowActionWidget` |
| `data-table:<tableId>:bulk-actions` | `InjectionBulkActionWidget` |
| `data-table:<tableId>:filters` | `InjectionFilterWidget` |
