# SPEC-041g — CrudForm Field Injection

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | G (PR 7) |
| **Branch** | `feat/umes-crudform-fields` |
| **Depends On** | Phase A (Foundation), Phase D (Response Enrichers) |
| **Status** | Draft |

## Goal

Allow modules to inject fields into existing CrudForm groups using the **triad pattern**: enricher loads data → field widget renders → `onSave` persists through module's own API. The core API never sees injected field data.

---

## The Triad Pattern

```
Step 1 — LOAD:    Response Enricher adds data to API response (Phase D)
Step 2 — RENDER:  Field widget displays enriched data as editable field
Step 3 — SAVE:    Widget onSave persists via module's own API (NOT core API)
```

### Complete Save Flow

```
User edits injected field and clicks Save
  │
  ├─ CrudForm collects ALL field values (core + injected)
  ├─ CrudForm validates core fields via Zod
  │  (injected fields excluded from core schema validation)
  ├─ Widget onBeforeSave handlers run (can validate injected fields)
  ├─ CrudForm sends core fields to core API:
  │  PUT /api/customers/people  { id, firstName, ... }
  │  (_example fields NOT sent to core API)
  ├─ Widget onSave handlers run (each saves its own data):
  │  PUT /api/example/customer-priorities/:id  { priority: 'high' }
  └─ Widget onAfterSave handlers run (cleanup, refresh)
```

**Key design**: The core API never sees injected fields. Each widget saves its own data through its own API.

---

## Scope

### 1. CrudForm Modifications

- Read `fields` array from injection widgets targeting `crud-form:<entityId>:fields`
- Insert fields into specified groups at specified positions using `InjectionPlacement`
- Populate injected field initial values from enriched response data via dot-path accessor
- Exclude injected field values from core Zod schema validation
- Trigger `onBeforeSave`/`onSave`/`onAfterSave` on widget event handlers (existing mechanism)

### 2. `InjectedField` Component

```typescript
// packages/ui/src/backend/injection/InjectedField.tsx

interface InjectedFieldProps {
  field: {
    id: string
    label: string       // i18n key
    type: 'text' | 'select' | 'number' | 'date' | 'boolean' | 'textarea'
    options?: { value: string; label: string }[]
    readOnly?: boolean
    group?: string
    placement?: InjectionPlacement
  }
  value: unknown
  onChange: (fieldId: string, value: unknown) => void
  isLoading?: boolean
}
```

Renders the appropriate input based on `field.type`, using the same UI primitives as CrudForm for visual consistency.

### 3. Field Value Reading via Dot-Path

Injected fields use dot-path accessors to read from enriched data:
- Field `id: '_example.priority'` reads from `record._example.priority`
- Uses lodash-style `get(data, path)` for nested access

---

## Example Module Additions

### `example/data/entities.ts` — add `ExampleCustomerPriority` entity

```typescript
@Entity({ tableName: 'example_customer_priorities' })
export class ExampleCustomerPriority extends BaseEntity {
  @Property()
  customerId!: string  // FK to customers.people.id (no ORM relation)

  @Property({ default: 'normal' })
  priority!: string    // 'low' | 'normal' | 'high' | 'critical'

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string
}
```

Run `yarn db:generate` to create migration.

### Update `example/data/enrichers.ts`

Add priority to the existing enricher (from Phase D):

```typescript
// Add to enrichOne:
const priority = await ctx.em.findOne('ExampleCustomerPriority', {
  customerId: record.id,
  organizationId: ctx.organizationId,
})
return {
  ...record,
  _example: {
    todoCount: todos.length,
    latestTodo: latest ? { id: latest.id, title: latest.title } : null,
    priority: priority?.priority ?? 'normal',  // NEW
  },
}

// Add to enrichMany (batch fetch):
const allPriorities = await ctx.em.find('ExampleCustomerPriority', {
  customerId: { $in: personIds },
  organizationId: ctx.organizationId,
})
const priorityMap = new Map(allPriorities.map(p => [p.customerId, p]))
// Merge into each record's _example namespace
```

### `example/api/customer-priorities/route.ts`

Simple CRUD endpoint for customer priorities:

```typescript
export const { GET, POST, PUT } = makeCrudRoute({
  entity: ExampleCustomerPriority,
  basePath: 'example/customer-priorities',
  schemas: { create: createSchema, update: updateSchema, list: listSchema },
  features: { write: ['example.create'] },
})
export const openApi = { ... }
```

### `example/widgets/injection/customer-priority-field/widget.ts`

Injects a "Priority" select field into customer edit form:

```typescript
// packages/core/src/modules/example/widgets/injection/customer-priority-field/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'

export default {
  metadata: {
    id: 'example.injection.customer-priority-field',
    title: 'Customer Priority',
    features: ['example.create'],
  },
  fields: [
    {
      id: '_example.priority',
      label: 'example.field.priority',
      type: 'select',
      options: [
        { value: 'low', label: 'example.priority.low' },
        { value: 'normal', label: 'example.priority.normal' },
        { value: 'high', label: 'example.priority.high' },
        { value: 'critical', label: 'example.priority.critical' },
      ],
      group: 'details',
      placement: { position: InjectionPosition.After, relativeTo: 'status' },
      readOnly: false,
    },
  ],
  eventHandlers: {
    onBeforeSave: async (data, context) => {
      const priority = data['_example.priority']
      if (priority === 'critical') {
        const notes = data['notes'] ?? ''
        if (!notes || (notes as string).length < 5) {
          return {
            ok: false,
            message: 'Critical priority requires a note explaining why.',
            fieldErrors: { notes: 'Required for critical priority' },
          }
        }
      }
      return { ok: true }
    },
    onSave: async (data, context) => {
      const priority = data['_example.priority'] ?? 'normal'
      const customerId = context.resourceId
      if (!customerId) return

      await apiCallOrThrow(
        '/api/example/customer-priorities',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            customerId,
            priority,
            organizationId: context.organizationId,
            tenantId: context.tenantId,
          }),
        },
        { errorMessage: 'Failed to save customer priority' },
      )
    },
  },
} satisfies InjectionFieldWidget
```

### `example/widgets/injection-table.ts` update

```typescript
'crud-form:customers.person:fields': {
  widgetId: 'example.injection.customer-priority-field',
  priority: 50,
},
```

---

## Integration Tests

### TC-UMES-CF01: Injected "Priority" field appears in customer edit form within "Details" group

**Type**: UI (Playwright)

**Preconditions**: Example module enabled, customer exists

**Steps**:
1. Create a customer via API
2. Navigate to customer edit form
3. Look for the "Priority" field in the Details group

**Expected**: A select dropdown labeled "Priority" appears in the Details group, after the "Status" field

**Testing notes**:
- Look for `[data-field-id="_example.priority"]` or label text
- Verify it's inside the correct form group
- Verify it has 4 options: low, normal, high, critical

### TC-UMES-CF02: Injected field loads initial value from enriched response

**Type**: UI (Playwright)

**Steps**:
1. Create a customer
2. Set priority to "high" via API (`POST /api/example/customer-priorities`)
3. Navigate to customer edit form
4. Check the Priority field value

**Expected**: Priority dropdown shows "High" as selected value

### TC-UMES-CF03: Editing injected field and saving persists via example module's API

**Type**: UI+API (Playwright)

**Steps**:
1. Create a customer
2. Navigate to edit form
3. Change Priority from "Normal" to "High"
4. Click Save (Cmd+Enter)
5. Verify via API: GET `/api/example/customer-priorities?customerId=:id`

**Expected**: Customer priority saved as "high" via example module's API. Core customer fields unchanged.

**Testing notes**:
- Monitor network requests to verify:
  - PUT to `/api/customers/people` does NOT contain `_example.priority`
  - POST to `/api/example/customer-priorities` contains `{ priority: 'high' }`

### TC-UMES-CF04: Widget `onBeforeSave` validation blocks save on invalid injected field value

**Type**: UI (Playwright)

**Steps**:
1. Create a customer
2. Navigate to edit form
3. Set Priority to "Critical"
4. Leave notes field empty (or < 5 chars)
5. Click Save

**Expected**: Save blocked with error "Critical priority requires a note explaining why." and field error on notes

### TC-UMES-CF05: Core customer fields are unchanged (injected field data not sent to customer API)

**Type**: API (Playwright)

**Steps**:
1. Create a customer with known fields
2. Set priority via example API
3. PUT to `/api/customers/people/:id` with ONLY core fields
4. GET customer — verify core fields saved, `_example.priority` unchanged

**Expected**: Core API does not receive or persist `_example.priority`. Managed entirely by example module.

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/ui/src/backend/injection/InjectedField.tsx` |
| **NEW** | `packages/core/src/modules/example/widgets/injection/customer-priority-field/widget.ts` |
| **NEW** | `packages/core/src/modules/example/data/entities.ts` (add ExampleCustomerPriority) |
| **NEW** | `packages/core/src/modules/example/api/customer-priorities/route.ts` |
| **MODIFY** | `packages/ui/src/backend/CrudForm.tsx` (read fields from injection widgets, insert into groups) |
| **MODIFY** | `packages/core/src/modules/example/data/enrichers.ts` (add priority enrichment) |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection-table.ts` |

**Estimated scope**: Large — CrudForm modification is delicate

---

## Backward Compatibility

- CrudForm existing behavior unchanged for modules without field injection widgets
- Core Zod schema validation unchanged — injected fields excluded
- `onBeforeSave`/`onSave`/`onAfterSave` handler pipeline unchanged
- Existing `InjectionSpot` rendering in CrudForm unchanged
