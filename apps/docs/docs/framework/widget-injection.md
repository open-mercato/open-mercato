# Widget Injection System

The Widget Injection System provides a centralized mechanism for injecting custom widgets into admin pages, similar to dashboard widgets but generalized for any location in the admin UI.

## Overview

The widget injection system allows modules to:
- Define reusable widgets with standardized event handlers
- Map widgets to specific injection spots (e.g., CRUD forms, detail pages)
- Respond to lifecycle events (`onLoad`, `onBeforeSave`, `onSave`, `onAfterSave`)
- Block or augment standard behaviors (e.g., validation, side effects)
- Render multiple widgets per spot with placement hints (stacked, grouped cards, or tabs)

## Architecture

### Key Components

1. **Injection Widgets** - React components with event handlers
2. **Injection Tables** - Mappings of spot IDs to widget IDs
3. **Injection Spots** - Locations where widgets can be injected
4. **Event Handlers** - Lifecycle hooks for widget behavior

### Directory Structure

```
src/modules/<module>/
├── widgets/
│   ├── injection/
│   │   └── <widget-name>/
│   │       ├── widget.ts          # Widget definition & event handlers
│   │       └── widget.client.tsx  # React component (client-side)
│   └── injection-table.ts         # Spot ID → Widget ID mappings
```

### Built-in Injection Spots

- **CRUD forms**: `crud-form:<entityId>` (automatically derived from `entityId`/`entityIds` passed to `CrudForm`). Widgets can request `placement.kind: 'group'` to render as a side-card and `column: 2` to appear in the right column.
- **Data tables**: `data-table:<tableId>` (or pass `injectionSpotId` to `DataTable`). Header/footer child spots: `:header`, `:footer`.
- **Admin layout wrapper**: `admin.page:<path-handle>:before|after` from `PageInjectionBoundary` (wraps every backend page).
- **Global backend mutations**: `backend-mutation:global` (mounted once in `AppShell`, available on backend pages regardless of whether they use `CrudForm`).

## Creating an Injection Widget

### 1. Define the Widget

Create `src/modules/<module>/widgets/injection/<widget-name>/widget.ts`:

```typescript
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import MyWidgetClient from './widget.client'

const widget: InjectionWidgetModule<ContextType, DataType> = {
  metadata: {
    id: 'module.injection.widget-name',
    title: 'Widget Title',
    description: 'Widget description',
    features: ['module.feature'],
    priority: 100,
    enabled: true,
  },
  Widget: MyWidgetClient,
  eventHandlers: {
    onLoad: async (context) => {
      // Called when widget loads
      console.log('Widget loaded', context)
    },
    onBeforeSave: async (data, context) => {
      // Called before save action
      // Return false to prevent save, or provide a message/field errors
      if (!isValid(data)) {
        return {
          ok: false,
          message: 'Title is required before saving',
          fieldErrors: { title: 'Title is required' },
        }
      }
      return { ok: true }
    },
    onSave: async (data, context) => {
      // Called during save action
      console.log('Saving', data)
    },
    onAfterSave: async (data, context) => {
      // Called after successful save
      console.log('Saved', data)
    },
  },
}

export default widget
```

### 2. Create the Widget Component

Create `src/modules/<module>/widgets/injection/<widget-name>/widget.client.tsx`:

```typescript
"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

export default function MyWidget({ context, data, onDataChange, disabled }: InjectionWidgetComponentProps) {
  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">
      <div className="font-medium text-blue-900">My Widget</div>
      <div className="text-blue-700 mt-1">
        Custom content here. Context: {JSON.stringify(context)}
      </div>
      {disabled && <div className="text-xs text-gray-500 mt-1">Saving...</div>}
    </div>
  )
}
```

### 3. Register in Injection Table

Create or edit `src/modules/<module>/widgets/injection-table.ts`:

```typescript
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  // Map injection spot IDs to widget IDs
  'crud-form:catalog.product': 'module.injection.widget-name',
  
  // Can also inject multiple widgets
  'crud-form:catalog.variant': [
    'module.injection.widget-name',
    'module.injection.another-widget',
  ],
}

export default injectionTable
```

## Using Injection Spots in CRUD Forms

The `CrudForm` component automatically supports widget injection:

```typescript
<CrudForm
  fields={fields}
  onSubmit={handleSubmit}
  injectionSpotId="crud-form:catalog.product"
  // ... other props
/>
```

### Standard Injection Spot IDs

Use the helper functions to generate consistent spot IDs:

```typescript
import { generateCrudFormInjectionSpotId, CrudFormInjectionSpots } from '@open-mercato/ui/backend/injection/helpers'

// Basic form spot
const spotId = generateCrudFormInjectionSpotId('catalog.product')
// Result: 'crud-form:catalog.product'

// Specific locations
const beforeFieldsSpot = CrudFormInjectionSpots.beforeFields('catalog.product')
// Result: 'crud-form:catalog.product:before-fields'

const afterFieldsSpot = CrudFormInjectionSpots.afterFields('catalog.product')
// Result: 'crud-form:catalog.product:after-fields'
```

## Event Handler Reference

### onLoad

Called when the widget is first mounted.

**Signature:**
```typescript
onLoad?: (context: TContext) => void | Promise<void>
```

**Use Cases:**
- Initialize widget state
- Fetch additional data
- Register listeners

### onBeforeSave

Called before a save action is executed. Can prevent the save by returning `false` or throwing an error.

**Signature:**
```typescript
onBeforeSave?: (data: TData, context: TContext) => boolean | { ok?: boolean; message?: string; fieldErrors?: Record<string, string> } | void | Promise<boolean | { ok?: boolean; message?: string; fieldErrors?: Record<string, string> } | void>
```

**Use Cases:**
- Validation
- Confirmation dialogs
- Data transformation
- Blocking invalid operations

**Example:**
```typescript
onBeforeSave: async (data, context) => {
  if (!data.title || data.title.length < 10) {
    alert('Title must be at least 10 characters')
    return false  // Prevent save
  }
  return true  // Allow save
}
```

### onSave

Called when save action is triggered (alongside the main save operation).

**Signature:**
```typescript
onSave?: (data: TData, context: TContext) => void | Promise<void>
```

**Use Cases:**
- Side effects during save
- Logging
- Analytics

### onAfterSave

Called after save completes successfully.

**Signature:**
```typescript
onAfterSave?: (data: TData, context: TContext) => void | Promise<void>
```

**Use Cases:**
- Success notifications
- Cache invalidation
- Related data updates

## Advanced Usage

### Using the Injection Spot Hook

For custom components that need to trigger injection widget events:

```typescript
import { useInjectionSpotEvents } from '@open-mercato/ui/backend/injection/InjectionSpot'

function MyCustomForm() {
  const { triggerEvent } = useInjectionSpotEvents('crud-form:my.form')
  
  const handleSave = async (data) => {
    // Trigger onBeforeSave
    const canProceed = await triggerEvent('onBeforeSave', data, context)
    if (!canProceed) {
      return // Blocked by widget
    }
    
    // Trigger onSave
    await triggerEvent('onSave', data, context)
    
    // Perform save
    await saveData(data)
    
    // Trigger onAfterSave
    await triggerEvent('onAfterSave', data, context)
  }
  
  return <form onSubmit={handleSave}>...</form>
}
```

### Global Mutation Hook for Non-CrudForm Screens

For backend pages that do not use `CrudForm` (for example custom detail screens), use the global mutation spot and emit the generic mutation error event.

```typescript
import { useInjectionSpotEvents } from '@open-mercato/ui/backend/injection/InjectionSpot'
import {
  GLOBAL_MUTATION_INJECTION_SPOT_ID,
  dispatchBackendMutationError,
} from '@open-mercato/ui/backend/injection/mutationEvents'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'

const { triggerEvent } = useInjectionSpotEvents(GLOBAL_MUTATION_INJECTION_SPOT_ID)

async function runMutation(operation: () => Promise<unknown>, payload: Record<string, unknown>, context: Record<string, unknown>) {
  const beforeSave = await triggerEvent('onBeforeSave', payload, context)
  if (!beforeSave.ok) {
    dispatchBackendMutationError({ contextId: context.formId as string, error: beforeSave.details ?? beforeSave })
    throw new Error(beforeSave.message ?? 'Save blocked by validation')
  }

  try {
    const result =
      beforeSave.requestHeaders && Object.keys(beforeSave.requestHeaders).length > 0
        ? await withScopedApiRequestHeaders(beforeSave.requestHeaders, operation)
        : await operation()
    await triggerEvent('onAfterSave', payload, context)
    return result
  } catch (error) {
    dispatchBackendMutationError({ contextId: context.formId as string, error })
    throw error
  }
}
```

This keeps API helpers generic while still enabling module-level behaviors such as conflict dialogs, validation, or save guards.

### Directly Rendering an Injection Spot

```typescript
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'

function MyPage() {
  const context = { pageId: 'my-page', userId: currentUser.id }
  const [data, setData] = useState({})
  
  return (
    <div>
      <InjectionSpot
        spotId="page:my-page:header"
        context={context}
        data={data}
        onDataChange={setData}
      />
      {/* Rest of page */}
    </div>
  )
}
```

## Examples

Here’s how injected widgets look in the admin UI:

![Injected form widget banner](/screenshots/open-mercato-widget-injection-form.png)

![Injected validation card that blocks save](/screenshots/open-mercato-widget-injection-validation.png)

![Injected data table widget in products list](/screenshots/open-mercato-injection-data-table.png)

See these modules for reference implementations:

- `packages/example/src/modules/example/widgets/injection/crud-validation` - Basic validation widget
- `packages/core/src/modules/catalog/widgets/injection/product-seo` - SEO helper widget for products

## Code Generation

The widget injection system is integrated into the module code generator:

1. Widgets in `src/modules/<module>/widgets/injection/**/widget.ts(x)` are auto-discovered
2. Injection tables in `src/modules/<module>/widgets/injection-table.ts` are auto-loaded
3. Generated registry files are created in `generated/injection-widgets.generated.ts`
4. Run `yarn generate` to regenerate

## Best Practices

1. **Keep widgets focused** - Each widget should have a single, clear purpose
2. **Use descriptive IDs** - Follow the pattern `module.injection.widget-name`
3. **Handle errors gracefully** - Catch errors in event handlers to avoid breaking the form
4. **Document context requirements** - Clearly specify what data the widget expects in context
5. **Use TypeScript** - Leverage type safety for context and data types
6. **Test event handlers** - Ensure validation logic works correctly
7. **Respect disabled state** - Disable UI interactions when `disabled` prop is true

## Troubleshooting

### Widget not appearing

1. Check that the widget is in the correct directory structure
2. Verify the injection table maps the spot ID correctly
3. Run `yarn generate` to regenerate
4. Check browser console for loading errors

### Events not firing

1. Ensure the injection spot ID matches exactly
2. Check that event handlers are defined in the widget module
3. Verify the host component is using `useInjectionSpotEvents` or `InjectionSpot`
4. Check for errors in the event handler itself

### TypeScript errors

1. Import types from `@open-mercato/shared/modules/widgets/injection`
2. Use the correct generic types for context and data
3. Ensure the widget module default export matches `InjectionWidgetModule`
