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

The actual CrudForm save pipeline (verified against `CrudForm.tsx` lines 1315–1508):

```
User edits injected field and clicks Save (Cmd+Enter)
  │
  ├─ CrudForm collects ALL field values (core + injected)
  ├─ CrudForm validates core fields via Zod
  │  (injected fields excluded from core schema validation)
  ├─ transformFormData pipeline runs (if extended events enabled)
  ├─ Widget onBeforeSave handlers run (can validate injected fields, can block)
  ├─ setPending(true)
  ├─ Widget onSave handlers run FIRST (each saves its own data):
  │  POST /api/example/customer-priorities  { customerId, priority: 'high' }
  ├─ CrudForm sends core fields to core API SECOND (onSubmit):
  │  PUT /api/customers/people  { id, firstName, ... }
  │  (_example fields NOT sent to core API)
  └─ Widget onAfterSave handlers run (cleanup, refresh)
```

**Key design**: The core API never sees injected fields. Each widget saves its own data through its own API.

**Important**: Widget `onSave` fires BEFORE the core API call (`onSubmit`). This means injected field data is persisted before the core entity is updated. If the core save fails after widget saves succeed, the system may be in an inconsistent state. To mitigate this:
- Widget save endpoints SHOULD be **idempotent** (safe to retry)
- Widget save endpoints SHOULD use **upsert** semantics (create-or-update) rather than always POST

---

## Scope

### 1. CrudForm Modifications

- Read `fields` array from injection widgets targeting `crud-form:<entityId>:fields`
- Insert fields into specified groups at specified positions using `InjectionPlacement`
- Populate injected field initial values from enriched response data via dot-path accessor
- Exclude injected field values from core Zod schema validation
- Trigger `onBeforeSave`/`onSave`/`onAfterSave` on widget event handlers (existing mechanism)
- **Group fallback**: if `field.group` references a group that doesn't exist in the CrudForm, the field is appended to the last group. A dev-mode console warning is logged: `[CrudForm] Injected field "${field.id}" targets group "${field.group}" which does not exist. Appended to last group.`
- **Dirty tracking**: injected fields participate in CrudForm's dirty tracking via the shared `values` state (same `onChange` callback). When an injected field changes, the form's unsaved-changes guard triggers normally

### 2. `InjectedField` Component

```typescript
// packages/ui/src/backend/injection/InjectedField.tsx

interface InjectedFieldProps {
  field: {
    id: string
    label: string       // i18n key
    type: 'text' | 'select' | 'number' | 'date' | 'boolean' | 'textarea' | 'custom'
    options?: { value: string; label: string }[]
    optionsLoader?: (context: FieldContext) => Promise<{ value: string; label: string }[]>
    optionsCacheTtl?: number  // Cache duration in seconds (default: 60)
    customComponent?: React.LazyExoticComponent<React.ComponentType<CustomFieldProps>>
    readOnly?: boolean
    group?: string
    placement?: InjectionPlacement
    visibleWhen?: FieldVisibilityCondition
  }
  value: unknown
  onChange: (fieldId: string, value: unknown) => void
  isLoading?: boolean
}

interface CustomFieldProps {
  value: unknown
  onChange: (value: unknown) => void
  field: InjectedFieldProps['field']
  context: FieldContext
  readOnly: boolean
}

interface FieldContext {
  resourceId?: string
  organizationId: string
  tenantId: string
  formData: Record<string, unknown>
}

interface FieldVisibilityCondition {
  field: string           // dot-path to another field in the form
  operator: 'eq' | 'neq' | 'in' | 'notIn' | 'truthy' | 'falsy'
  value?: unknown         // required for eq, neq, in, notIn
}
```

Renders the appropriate input based on `field.type`, using the same UI primitives as CrudForm for visual consistency.

### 3. Dynamic Options (`optionsLoader`)

When a field declares `optionsLoader` instead of (or alongside) static `options`, the `InjectedField` component calls the loader on mount and caches results for `optionsCacheTtl` seconds (default: 60). This enables integration modules to populate select options from external APIs (e.g., HubSpot pipelines, Akeneo attribute groups, BambooHR custom fields, Shopify locations).

```typescript
// Example: field with dynamic options from external API
{
  id: '_hubspot.pipeline',
  label: 'hubspot.field.pipeline',
  type: 'select',
  optionsLoader: async (context) => {
    const res = await apiCallOrThrow('/api/hubspot/pipelines', {
      headers: { 'x-organization-id': context.organizationId },
    })
    return res.items.map((p: any) => ({ value: p.id, label: p.label }))
  },
  optionsCacheTtl: 300,  // Cache for 5 minutes
  group: 'details',
}
```

If both `options` (static) and `optionsLoader` (dynamic) are provided, `optionsLoader` takes precedence. If the loader fails, the component falls back to `options` (if defined) and shows a console warning. If the loader fails and no static `options` are provided, the field renders as a disabled select with placeholder text "Options unavailable" and a console warning is logged with the field ID.

### 4. Custom Field Component (`type: 'custom'`)

When `type` is `'custom'`, the `InjectedField` renders `customComponent` instead of a built-in input. The custom component receives `CustomFieldProps` and must handle its own rendering and state. This unlocks field mapping widgets, media gallery pickers, template editors, and other complex UIs.

```typescript
// Example: integration field mapping widget as a custom field
{
  id: '_sync.fieldMapping',
  label: 'sync.field.fieldMapping',
  type: 'custom',
  customComponent: lazy(() => import('./FieldMappingEditor')),
  group: 'sync-settings',
}
```

The custom component is lazy-loaded and only imported when the field is rendered. It receives the full `FieldContext` including current form data, which allows it to react to other field values.

### 5. Conditional Field Visibility (`visibleWhen`)

Fields can declare `visibleWhen` to conditionally show/hide based on another field's value. The `InjectedField` evaluates the condition reactively — when the referenced field changes, the conditional field shows/hides immediately.

```typescript
// Example: show OAuth fields only when authMethod is 'oauth2'
{
  id: '_integration.oauthClientId',
  label: 'integration.field.oauthClientId',
  type: 'text',
  group: 'credentials',
  visibleWhen: {
    field: 'authMethod',
    operator: 'eq',
    value: 'oauth2',
  },
}
```

**Operator semantics:**
- `eq`: `formData[field] === value`
- `neq`: `formData[field] !== value`
- `in`: `(value as unknown[]).includes(formData[field])`
- `notIn`: `!(value as unknown[]).includes(formData[field])`
- `truthy`: `Boolean(formData[field])`
- `falsy`: `!formData[field]`

Hidden fields are excluded from save payloads (not sent to `onSave`). The condition is evaluated in the component — no server roundtrip.

**Dot-path evaluation**: `visibleWhen.field` uses the same dot-path convention as field IDs. The condition evaluates against the flat form values object using the field ID as a key (e.g., `formData['_example.priority']`), NOT nested object access. This matches how CrudForm stores values internally — dot-path field IDs are flat keys in the values record.

### 6. Field Value Reading via Dot-Path

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

## InjectedField Component Implementation

```typescript
// packages/ui/src/backend/injection/InjectedField.tsx

function InjectedField({ field, value, onChange, isLoading }: InjectedFieldProps) {
  const t = useT()

  switch (field.type) {
    case 'select':
      return (
        <FormField label={t(field.label)}>
          <Select
            value={value as string}
            onChange={(v) => onChange(field.id, v)}
            options={(field.options ?? []).map(o => ({ value: o.value, label: t(o.label) }))}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    case 'text':
      return (
        <FormField label={t(field.label)}>
          <Input
            value={value as string ?? ''}
            onChange={(e) => onChange(field.id, e.target.value)}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    case 'textarea':
      return (
        <FormField label={t(field.label)}>
          <Textarea
            value={value as string ?? ''}
            onChange={(e) => onChange(field.id, e.target.value)}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    case 'number':
      return (
        <FormField label={t(field.label)}>
          <Input
            type="number"
            value={value as number ?? ''}
            onChange={(e) => onChange(field.id, Number(e.target.value))}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    case 'boolean':
      return (
        <FormField label={t(field.label)}>
          <Checkbox
            checked={Boolean(value)}
            onChange={(checked) => onChange(field.id, checked)}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    case 'date':
      return (
        <FormField label={t(field.label)}>
          <DatePicker
            value={value as string}
            onChange={(date) => onChange(field.id, date)}
            disabled={field.readOnly || isLoading}
          />
        </FormField>
      )
    case 'custom': {
      if (!field.customComponent) return null
      const CustomComp = field.customComponent
      return (
        <Suspense fallback={<Spinner size="sm" />}>
          <CustomComp
            value={value}
            onChange={(v) => onChange(field.id, v)}
            field={field}
            context={fieldContext}
            readOnly={field.readOnly || isLoading}
          />
        </Suspense>
      )
    }
  }
}
```

Renders the appropriate input based on `field.type`, using the same UI primitives as CrudForm for visual consistency.

---

## End-to-End Example: "Carrier Instructions" Field in Shipment Dialog

A complete walkthrough: a `carrier_integration` module adds a "Special Instructions" textarea to the shipment dialog without touching any file in `packages/core/src/modules/sales/`.

**Requirements:**
1. Show a "Special Instructions" field in the shipment dialog's "Tracking information" group
2. Load existing instructions when editing a shipment
3. Save instructions to the carrier integration module's own table — not to `sales_shipments`
4. Never modify any file in `packages/core/src/modules/sales/`

### Step 1 — Data Model

```typescript
// carrier_integration/data/entities.ts
@Entity({ tableName: 'carrier_shipment_instructions' })
export class CarrierShipmentInstructions extends BaseEntity {
  @Property()
  shipmentId!: string              // FK to sales_shipments.id (no ORM relation)

  @Property({ type: 'text', nullable: true })
  specialInstructions?: string

  @Property({ type: 'text', nullable: true })
  handlingCode?: string

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string
}
```

### Step 2 — API Endpoint

```typescript
// carrier_integration/api/shipment-instructions/route.ts
export const { GET, POST, PUT, DELETE } = makeCrudRoute({
  entity: CarrierShipmentInstructions,
  basePath: 'carrier-integration/shipment-instructions',
  schemas: { create: createSchema, update: updateSchema, list: listSchema },
  features: { write: ['carrier_integration.manage'] },
})
export const openApi = { ... }
```

### Step 3 — Response Enricher

```typescript
// carrier_integration/data/enrichers.ts
export const enrichers: ResponseEnricher[] = [
  {
    id: 'carrier_integration.shipment-instructions',
    targetEntity: 'sales.sales_shipment',
    features: ['carrier_integration.view'],

    async enrichOne(record, ctx) {
      const instructions = await ctx.em.findOne(CarrierShipmentInstructions, {
        shipmentId: record.id,
        organizationId: ctx.organizationId,
      })
      return {
        ...record,
        _carrierInstructions: {
          specialInstructions: instructions?.specialInstructions ?? '',
          handlingCode: instructions?.handlingCode ?? '',
        },
      }
    },

    async enrichMany(records, ctx) {
      const shipmentIds = records.map(r => r.id)
      const all = await ctx.em.find(CarrierShipmentInstructions, {
        shipmentId: { $in: shipmentIds },
        organizationId: ctx.organizationId,
      })
      const map = new Map(all.map(i => [i.shipmentId, i]))
      return records.map(record => ({
        ...record,
        _carrierInstructions: {
          specialInstructions: map.get(record.id)?.specialInstructions ?? '',
          handlingCode: map.get(record.id)?.handlingCode ?? '',
        },
      }))
    },
  },
]
```

### Step 4 — Widget (Field Injection)

```typescript
// carrier_integration/widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  'crud-form:sales.sales_shipment': {
    widgetId: 'carrier_integration.injection.shipment-instructions-field',
    priority: 50,
  },
}
```

```typescript
// carrier_integration/widgets/injection/shipment-instructions-field/widget.ts
export default {
  metadata: {
    id: 'carrier_integration.injection.shipment-instructions-field',
    title: 'Carrier Instructions',
    features: ['carrier_integration.manage'],
  },
  fields: [
    {
      id: '_carrierInstructions.specialInstructions',
      label: 'carrier_integration.field.specialInstructions',
      type: 'textarea',
      group: 'tracking',
      placement: { position: InjectionPosition.After, relativeTo: 'notes' },
    },
    {
      id: '_carrierInstructions.handlingCode',
      label: 'carrier_integration.field.handlingCode',
      type: 'select',
      options: [
        { value: 'standard', label: 'carrier_integration.handling.standard' },
        { value: 'fragile', label: 'carrier_integration.handling.fragile' },
        { value: 'hazmat', label: 'carrier_integration.handling.hazmat' },
        { value: 'refrigerated', label: 'carrier_integration.handling.refrigerated' },
      ],
      group: 'tracking',
      placement: { position: InjectionPosition.After, relativeTo: '_carrierInstructions.specialInstructions' },
    },
  ],
  eventHandlers: {
    onSave: async (data, context) => {
      const specialInstructions = data['_carrierInstructions.specialInstructions'] ?? ''
      const handlingCode = data['_carrierInstructions.handlingCode'] ?? 'standard'
      const shipmentId = context.resourceId
      if (!shipmentId) return

      // Upsert: check if record exists from enricher data, then PUT or POST
      const existing = data['_carrierInstructions.specialInstructions'] !== undefined
      const method = existing ? 'PUT' : 'POST'
      const url = existing
        ? `/api/carrier-integration/shipment-instructions/${shipmentId}`
        : '/api/carrier-integration/shipment-instructions'

      await apiCallOrThrow(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            shipmentId, specialInstructions, handlingCode,
            organizationId: context.organizationId,
            tenantId: context.tenantId,
          }),
        },
        { errorMessage: 'Failed to save carrier instructions' },
      )
    },
    onBeforeSave: async (data, context) => {
      const handlingCode = data['_carrierInstructions.handlingCode']
      if (handlingCode === 'hazmat') {
        const instructions = data['_carrierInstructions.specialInstructions'] ?? ''
        if (instructions.trim().length < 10) {
          return {
            ok: false,
            message: 'Hazmat shipments require detailed special instructions (min 10 chars).',
            fieldErrors: { '_carrierInstructions.specialInstructions': 'Required for hazmat shipments' },
          }
        }
      }
      return { ok: true }
    },
  },
} satisfies InjectionFieldWidget
```

### Step 5 — Translations

```typescript
// carrier_integration/i18n/en.ts
export default {
  'carrier_integration.field.specialInstructions': 'Special Instructions',
  'carrier_integration.field.handlingCode': 'Handling Code',
  'carrier_integration.handling.standard': 'Standard',
  'carrier_integration.handling.fragile': 'Fragile',
  'carrier_integration.handling.hazmat': 'Hazmat',
  'carrier_integration.handling.refrigerated': 'Refrigerated',
}
```

### What Happens at Runtime

**Edit shipment dialog opens:**
```
1. Order detail page opens ShipmentDialog for shipment id=abc
2. ShipmentDialog renders CrudForm with entityId='sales.sales_shipment'
3. CrudForm loads initial values (including existing data from shipment)
4. Response enricher has already attached _carrierInstructions to the shipment data
5. CrudForm discovers injected field widgets via injection-table
6. The "Tracking information" group now renders:
   - Shipped date        ← core field
   - Delivered date       ← core field
   - Tracking numbers     ← core field
   - Notes               ← core field
   - Special Instructions ← INJECTED (from carrier_integration)
   - Handling Code        ← INJECTED (from carrier_integration)
```

**User fills in fields and clicks Save (Cmd+Enter):**
```
1. CrudForm validates core fields (Zod schema)
2. transformFormData pipeline runs
3. CrudForm triggers onBeforeSave on all injection widgets
   → carrier_integration validates: hazmat requires instructions ≥10 chars
4. setPending(true)
5. CrudForm triggers onSave on all injection widgets FIRST
   → carrier_integration upserts to /api/carrier-integration/shipment-instructions
6. CrudForm calls onSubmit() → sends core fields to PUT /api/sales/shipments SECOND
   → The _carrierInstructions fields are NOT sent (not in shipment Zod schema)
7. CrudForm triggers onAfterSave → dialog closes, shipments list refreshes
```

**Files touched in `packages/core/src/modules/sales/`: ZERO.**

---

## CrudForm Group Injection (Existing — Formalized)

Already works via current injection table with `kind: 'group'` and `column` placement. Formalized with explicit type:

```typescript
satisfies InjectionGroupWidget  // Existing pattern, now typed
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

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase G — CrudForm Field Injection | In Progress | 2026-02-26 | Added `InjectedField`, field spot loading, group insertion, visibility-aware payload exclusion, and form handles. |
