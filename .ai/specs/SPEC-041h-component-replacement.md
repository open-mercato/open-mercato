# SPEC-041h — Component Replacement

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | H (PR 8) |
| **Branch** | `feat/umes-component-replacement` |
| **Depends On** | Phase A (Foundation) |
| **Status** | Draft |

## Goal

Allow modules to replace or wrap any registered component without forking — enabling complete component swaps, decorator wrappers, and props overrides.

---

## Scope

### 1. Component Registry

```typescript
// packages/shared/src/modules/widgets/component-registry.ts

type ComponentRegistryEntry<TProps = any> = {
  id: string                          // e.g., 'sales.order.shipment-dialog'
  component: React.ComponentType<TProps>
  metadata: {
    module: string
    description: string
    propsSchema?: z.ZodType<TProps>   // Typed contract
  }
}

// Registration (in core module)
registerComponent({
  id: 'sales.order.shipment-dialog',
  component: ShipmentDialog,
  metadata: { module: 'sales', description: 'Shipment dialog', propsSchema },
})

// Replacement (in another module)
replaceComponent({
  targetId: 'sales.order.shipment-dialog',
  component: NewShipmentDialog,
  metadata: { module: 'new_sales', priority: 100 },
})
```

### 2. `useRegisteredComponent(componentId)` Hook

```typescript
// packages/ui/src/backend/injection/useRegisteredComponent.ts

function useRegisteredComponent<TProps>(
  componentId: string
): React.ComponentType<TProps> {
  // 1. Check if any replacement registered (highest priority wins)
  // 2. Fall back to original component
  // 3. Log warning if multiple replacements at same priority
}
```

Usage in core modules:

```typescript
// Before (tightly coupled)
import { ShipmentDialog } from './components/ShipmentDialog'

// After (extensible)
const ShipmentDialog = useRegisteredComponent<ShipmentDialogProps>(
  'sales.order.shipment-dialog'
)
return <ShipmentDialog orderId={orderId} onClose={handleClose} />
```

### 3. Three Override Modes

| Mode | Use Case | Risk |
|------|----------|------|
| **Replace** | Complete swap of component | High — must maintain props contract |
| **Wrapper** | Add behavior around existing (decorating) | Low — original preserved |
| **Props Override** | Modify props passed to existing | Low — original preserved |

```typescript
type ComponentOverride = {
  target: { componentId?: string; displayName?: string }
  priority: number
  features?: string[]
} & (
  | { replacement: React.LazyExoticComponent<any> }
  | { wrapper: (Original: React.ComponentType) => React.ComponentType }
  | { propsTransform: (props: any) => any }
)
```

### 4. `ComponentOverrideProvider`

Context provider at app root that builds a lookup table from all module overrides:

```typescript
<ComponentOverrideProvider overrides={allModuleOverrides}>
  <AppShell>{children}</AppShell>
</ComponentOverrideProvider>
```

### 5. Auto-Discovery

`widgets/components.ts` — new auto-discovered file exporting `componentOverrides: ComponentOverride[]`.

`yarn generate` discovers and generates `component-overrides.generated.ts`.

---

## Example Module Additions

### Register todo edit dialog as replaceable (in example module)

```typescript
// packages/core/src/modules/example/components/TodoEditDialog.tsx
// At the bottom, register the component:
registerComponent({
  id: 'example.todo.edit-dialog',
  component: TodoEditDialog,
  metadata: {
    module: 'example',
    description: 'Dialog for editing a todo item',
  },
})
```

### `example/widgets/components.ts` — wrapper mode

A wrapper that adds a "Quick Notes" panel below the todo edit form:

```typescript
// packages/core/src/modules/example/widgets/components.ts
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'

export const componentOverrides: ComponentOverride[] = [
  {
    target: { componentId: 'example.todo.edit-dialog' },
    wrapper: (OriginalDialog) => {
      const WrappedDialog = (props: any) => (
        <div>
          <OriginalDialog {...props} />
          <div style={{ borderTop: '1px solid var(--border)', padding: '1rem', marginTop: '0.5rem' }}>
            <h4>Quick Notes</h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              This panel was injected by the example module's component wrapper.
            </p>
          </div>
        </div>
      )
      WrappedDialog.displayName = 'WrappedTodoEditDialog'
      return WrappedDialog
    },
    priority: 50,
    features: ['example.view'],
  },
]
```

---

## Integration Tests

### TC-UMES-CR01: Replaced component renders instead of original

**Type**: UI (Playwright)

**Preconditions**: Component override registered for `example.todo.edit-dialog`

**Steps**:
1. Navigate to example module's todo list
2. Click edit on a todo to open the dialog
3. Look for the wrapper's additional content

**Expected**: The wrapper renders alongside the original dialog (wrapper mode preserves original)

**Testing notes**:
- For full replacement mode, a separate test fixture would be needed
- The example uses wrapper mode — verify both original and wrapper content render

### TC-UMES-CR02: Wrapper mode renders original component with extra content

**Type**: UI (Playwright)

**Steps**:
1. Navigate to example module's todo list
2. Click edit on a todo to open the dialog
3. Look for the "Quick Notes" panel below the form

**Expected**: Original todo edit dialog renders normally, AND "Quick Notes" panel appears below it

**Testing notes**:
- Verify original form fields present (title, description, etc.)
- Verify "Quick Notes" heading visible
- Verify the injected text "This panel was injected..." is present

### TC-UMES-CR03: Component replacement respects ACL features

**Type**: UI (Playwright)

**Steps**:
1. Log in as user WITHOUT `example.view`
2. Open the todo edit dialog (if accessible)
3. Verify "Quick Notes" panel is NOT present

**Expected**: Wrapper not applied when user lacks the required feature

### TC-UMES-CR04: Highest priority replacement wins when multiple exist

**Type**: Unit (Vitest)

**Steps**:
1. Register two replacements for the same component:
   - Priority 50: Component A
   - Priority 100: Component B
2. Call `useRegisteredComponent('example.todo.edit-dialog')`

**Expected**: Component B (priority 100) is returned. Console warning logged about multiple replacements.

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/modules/widgets/component-registry.ts` |
| **NEW** | `packages/ui/src/backend/injection/useRegisteredComponent.ts` |
| **NEW** | `packages/ui/src/backend/injection/ComponentOverrideProvider.tsx` |
| **NEW** | `packages/core/src/modules/example/widgets/components.ts` |
| **MODIFY** | Generator scripts (discover `widgets/components.ts`) |
| **MODIFY** | Bootstrap registration (register component overrides) |
| **MODIFY** | App shell (wrap in `ComponentOverrideProvider`) |

**Estimated scope**: Medium

---

## Backward Compatibility

- Components that don't use `useRegisteredComponent` are completely unaffected
- No existing component rendering changed — opt-in per component
- `registerComponent` is additive — no existing code needs modification
- `ComponentOverrideProvider` at app root is transparent when no overrides exist
