# SPEC-041j — Recursive Widget Extensibility

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | J (PR 10) |
| **Branch** | `feat/umes-recursive-widgets` |
| **Depends On** | Phase A (Foundation) |
| **Status** | Draft |

## Goal

Allow widgets themselves to be extended by other widgets — enabling layered composition where modules can add behavior to other modules' widgets without those widgets knowing about them.

---

## Scope

### 1. Widget-Level Extension Points

Any widget can declare its own injection spots using the standard `InjectionSpot` component:

```typescript
function RecordLockingWidget({ context, data }: WidgetProps) {
  return (
    <div>
      <LockStatusBanner />
      {/* Other widgets can inject into this widget */}
      <InjectionSpot
        spotId={`widget:record_locks.crud-form-locking:actions`}
        context={context}
        data={data}
      />
      <ConflictResolutionDialog />
    </div>
  )
}
```

### 2. Naming Convention

Widget-level spots use the `widget:` prefix:

```
widget:<widgetId>:<spot>
```

Examples:
- `widget:record_locks.crud-form-locking:actions`
- `widget:record_locks.crud-form-locking:events`
- `widget:example.injection.crud-validation:addon`

### 3. Widget Behavior Extension

Modules can extend a widget's event handlers via injection-table:

```typescript
export const injectionTable: ModuleInjectionTable = {
  'widget:record_locks.crud-form-locking:events': {
    widgetId: 'audit.injection.lock-audit-trail',
    priority: 50,
  },
}
```

This enables layered composition — audit module adds logging to record-locking's save guard without record-locking knowing about audit.

---

## Example Module Additions

### Update `example/widgets/injection/crud-validation/widget.client.tsx`

Add a nested `InjectionSpot` inside the validation widget:

```typescript
"use client"
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'

export default function CrudValidationWidget({ context, data }: WidgetProps) {
  return (
    <div>
      <ValidationStatusBanner status={validationStatus} />
      {/* Nested extension point — other widgets can inject here */}
      <InjectionSpot
        spotId="widget:example.injection.crud-validation:addon"
        context={context}
        data={data}
      />
    </div>
  )
}
```

### `example/widgets/injection/crud-validation-addon/widget.ts`

Widget that injects into the validation widget's nested spot:

```typescript
// packages/core/src/modules/example/widgets/injection/crud-validation-addon/widget.ts
export default {
  metadata: {
    id: 'example.injection.crud-validation-addon',
    features: ['example.view'],
  },
  Widget: () => {
    return (
      <div style={{ padding: '0.5rem', background: 'var(--muted)', borderRadius: '0.25rem' }}>
        <small>Addon injected into validation widget's nested spot</small>
      </div>
    )
  },
  eventHandlers: {
    onBeforeSave: async (data, context) => {
      // Nested widget participates in save lifecycle
      console.log('[UMES] Nested addon widget onBeforeSave fired')
      return { ok: true }
    },
  },
}
```

### `example/widgets/injection-table.ts` update

```typescript
'widget:example.injection.crud-validation:addon': {
  widgetId: 'example.injection.crud-validation-addon',
  priority: 50,
},
```

---

## Integration Tests

### TC-UMES-RW01: Widget-level injection spot renders child widgets

**Type**: UI (Playwright)

**Preconditions**: Crud-validation widget renders on example todo create form

**Steps**:
1. Navigate to a page where the crud-validation widget renders (e.g., example todo create form)
2. Look for the addon content inside the validation widget

**Expected**: The text "Addon injected into validation widget's nested spot" appears inside the validation widget's area

**Testing notes**:
- Verify the addon is INSIDE the validation widget's DOM, not adjacent to it
- This confirms the `InjectionSpot` inside the widget works
- Use `page.locator('[data-injection-spot="widget:example.injection.crud-validation:addon"]')` if available

### TC-UMES-RW02: Nested widget's `onBeforeSave` handler participates in save lifecycle

**Type**: UI (Playwright)

**Steps**:
1. Navigate to todo create form (with validation widget + addon)
2. Fill in form fields
3. Click Save
4. Monitor console for the addon's onBeforeSave log

**Expected**: Both the parent widget's and the addon widget's `onBeforeSave` handlers fire during the save lifecycle

**Testing notes**:
- Use `page.on('console', ...)` to capture console.log output
- Verify "[UMES] Nested addon widget onBeforeSave fired" appears in console
- Verify the todo is created successfully (addon's onBeforeSave returns `{ ok: true }`)

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/core/src/modules/example/widgets/injection/crud-validation-addon/widget.ts` |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection/crud-validation/widget.client.tsx` (add nested InjectionSpot) |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection-table.ts` (add nested spot mapping) |

**Estimated scope**: Small — mostly documentation + example

---

## Backward Compatibility

- `InjectionSpot` already works inside widgets — this phase formalizes the pattern
- No changes to `InjectionSpot` component needed (it already resolves spots by ID)
- Naming convention (`widget:` prefix) is purely advisory — the system treats all spot IDs the same
- Existing widget rendering unchanged
