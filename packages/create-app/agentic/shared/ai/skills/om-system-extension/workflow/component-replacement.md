# Component Replacement

**Purpose**: Replace, wrap, or transform props of registered UI components without forking source code.

**File**: `src/modules/<your-module>/widgets/components.ts`

## Template

```typescript
import React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'

export const componentOverrides: ComponentOverride[] = [
  // Mode 1: Wrapper — decorate existing component (safest)
  {
    target: { componentId: ComponentReplacementHandles.section('ui.detail', 'NotesSection') },
    priority: 50,
    metadata: { module: '<your-module>' },
    wrapper: (Original) => {
      const Wrapped = (props: any) =>
        React.createElement(
          'div',
          { className: 'border border-blue-200 rounded-md p-2' },
          React.createElement(Original, props),
        )
      Wrapped.displayName = '<YourModule>NotesWrapper'
      return Wrapped
    },
  },

  // Mode 2: Props transform — modify incoming props
  {
    target: { componentId: ComponentReplacementHandles.dataTable('customers.people') },
    priority: 40,
    metadata: { module: '<your-module>' },
    propsTransform: (props: any) => ({
      ...props,
      defaultPageSize: 25,
    }),
  },

  // Mode 3: Replace — full component swap (highest risk)
  {
    target: { componentId: ComponentReplacementHandles.section('sales.order', 'ShipmentDialog') },
    priority: 50,
    metadata: { module: '<your-module>' },
    replacement: React.lazy(() => import('./CustomShipmentDialog')),
    propsSchema: ShipmentDialogPropsSchema,  // Zod schema for validation
  },
]
```

## Handle IDs

| Handle | Format | Example |
|--------|--------|---------|
| `page` | `page:<path>` | `page:backend/customers/people` |
| `dataTable` | `data-table:<tableId>` | `data-table:customers.people` |
| `crudForm` | `crud-form:<entityId>` | `crud-form:customers.person` |
| `section` | `section:<scope>.<sectionId>` | `section:ui.detail.NotesSection` |

## Rules

- Prefer `wrapper` mode — it preserves the original component and is least likely to break
- `replacement` mode REQUIRES a `propsSchema` (Zod) for dev-mode contract validation
- Always set `displayName` on wrapper components for React DevTools debugging
- Wrapper composition: lower priority = innermost, higher priority = outermost
