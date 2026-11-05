# SPEC-041m3 — Client-Side Event Filtering

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041m — Mutation Lifecycle](./SPEC-041m-mutation-lifecycle.md) |
| **Status** | Draft |

## Goal

Widget event handlers can declare an operation filter to control when they fire. This allows a widget to say "only run my `onBeforeSave` for updates, not creates."

---

## Widget Injection Event Filter

```typescript
// Added to packages/shared/src/modules/widgets/injection.ts

interface WidgetInjectionEventFilter {
  /** Only run handlers for these operations. Omit to run for all. */
  operations?: ('create' | 'update' | 'delete')[]
}

// Extended WidgetInjectionEventHandlers
interface WidgetInjectionEventHandlers<TContext, TData> {
  /** Filter which operations trigger these event handlers */
  filter?: WidgetInjectionEventFilter
  // ... all existing handlers unchanged ...
}
```

---

## CrudForm Integration

The CrudForm save pipeline already knows the current operation (create vs update). When invoking widget event handlers, it checks the `filter`:

```typescript
// In CrudForm save pipeline (pseudocode)
for (const widget of injectedWidgets) {
  const filter = widget.eventHandlers?.filter
  if (filter?.operations && !filter.operations.includes(currentOperation)) {
    continue  // Skip this widget's handlers for this operation
  }
  await widget.eventHandlers?.onBeforeSave?.(data, context)
}
```

The `InjectionContext` is extended to include the current operation:

```typescript
interface InjectionContext {
  // ... existing fields ...
  /** Current CRUD operation being performed */
  operation: 'create' | 'update' | 'delete'
}
```

---

## Example: Updated Widget with Client-Side Event Filter

```typescript
// packages/core/src/modules/example/widgets/injection/customer-priority-field/widget.ts
export default {
  metadata: { id: 'example.injection.customer-priority-field', title: 'Customer Priority', features: ['example.create'] },
  fields: [ /* ... existing fields ... */ ],
  eventHandlers: {
    filter: { operations: ['update'] },   // Only run validation on update, not create
    onBeforeSave: async (data, context) => {
      const priority = data['_example.priority']
      if (priority === 'critical') {
        const notes = data['notes'] ?? ''
        if (!notes || (notes as string).length < 5) {
          return { ok: false, message: 'Critical priority requires a note explaining why.', fieldErrors: { notes: 'Required for critical priority' } }
        }
      }
      return { ok: true }
    },
    onSave: async (data, context) => { /* ... existing save logic ... */ },
  },
} satisfies InjectionFieldWidget
```

---

## Integration Tests

### TC-UMES-ML07: Client-side event filter skips handler for filtered operation

**Type**: UI (Playwright)

**Steps**:
1. Create customer with Critical priority + empty notes → succeeds (filter skips 'create')
2. Edit same customer, set Critical + empty notes → fails (filter includes 'update')

---

## Backward Compatibility

- Widget `onBeforeSave` handlers: **unchanged** — new `filter` field is optional. Existing widgets without `filter` run for all operations (current behavior).

---

## Files Touched

| Action | File |
|--------|------|
| **MODIFY** | `packages/shared/src/modules/widgets/injection.ts` (add `WidgetInjectionEventFilter`) |
| **MODIFY** | `packages/ui/src/backend/injection/InjectionSpot.tsx` (check `filter.operations`) |
| **MODIFY** | `packages/ui/src/backend/CrudForm.tsx` (pass operation, filter handlers) |
