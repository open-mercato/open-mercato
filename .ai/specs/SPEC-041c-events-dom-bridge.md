# SPEC-041c — Extended Widget Events + DOM Event Bridge

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | C (PR 3) |
| **Branch** | `feat/umes-event-bridge` |
| **Depends On** | Phase A (Foundation) |
| **Status** | Draft |

## Goal

Expand widget event handlers with DOM-inspired lifecycle events and transformer pipelines. Bridge server-side app events to the browser so widgets can react instantly without polling.

---

## Scope

### 1. New Widget Event Handlers

```typescript
interface WidgetInjectionEventHandlers<TContext, TData> {
  // === Existing (unchanged) ===
  onLoad?(context: TContext): Promise<void>
  onBeforeSave?(data: TData, context: TContext): Promise<WidgetBeforeSaveResult>
  onSave?(data: TData, context: TContext): Promise<void>
  onAfterSave?(data: TData, context: TContext): Promise<void>
  onBeforeDelete?(data: TData, context: TContext): Promise<WidgetBeforeDeleteResult>
  onDelete?(data: TData, context: TContext): Promise<void>
  onAfterDelete?(data: TData, context: TContext): Promise<void>
  onDeleteError?(data: TData, context: TContext, error: unknown): Promise<void>

  // === New: DOM-Inspired Lifecycle ===
  onFieldChange?(fieldId: string, value: unknown, data: TData, context: TContext): Promise<FieldChangeResult | void>
  onBeforeNavigate?(target: string, context: TContext): Promise<NavigateGuardResult>
  onVisibilityChange?(visible: boolean, context: TContext): Promise<void>

  // === New: Data Transformation (Filter-style) ===
  transformFormData?(data: TData, context: TContext): Promise<TData>
  transformDisplayData?(data: TData, context: TContext): Promise<TData>
  transformValidation?(errors: FieldErrors, data: TData, context: TContext): Promise<FieldErrors>

  // === New: App Event Reaction ===
  onAppEvent?(event: AppEventPayload, context: TContext): Promise<void>
}

interface FieldChangeResult {
  value?: unknown
  sideEffects?: Record<string, unknown>
  message?: { text: string; severity: 'info' | 'warning' | 'error' }
}

interface NavigateGuardResult {
  ok: boolean
  message?: string
}
```

### 2. Dual-Mode Event Dispatch

The existing `triggerEvent` function dispatches **action events** (fire handler, accumulate `requestHeaders`, check `ok` boolean). Transformer events require a **pipeline** dispatch (output of widget N becomes input of widget N+1).

```typescript
// Existing behavior — unchanged for action events
if (isActionEvent(event)) {
  // Current logic: iterate widgets, accumulate requestHeaders, check ok
}

// New behavior — pipeline for transformer events
if (isTransformerEvent(event)) {
  let result = initialData
  for (const widget of sortedWidgets) {
    result = await widget.eventHandlers[event](result, context)
  }
  return result
}
```

**Action events** (existing + new): `onLoad`, `onBeforeSave`, `onSave`, `onAfterSave`, `onBeforeDelete`, `onDelete`, `onAfterDelete`, `onDeleteError`, `onFieldChange`, `onBeforeNavigate`, `onVisibilityChange`, `onAppEvent`

**Transformer events** (new): `transformFormData`, `transformDisplayData`, `transformValidation`

The delete-to-save fallback chain is preserved.

### 3. DOM Event Bridge

#### Architecture

```
Server-side event bus                         Browser
─────────────────────                         ───────
example.todo.created ──► event bus
  │                        │
  ├── subscribers/*.ts     │ (existing)
  └── SSE push ──────────►│ DOM Event Bridge
                           ▼
                    window.dispatchEvent(
                      new CustomEvent('om:event', {
                        detail: { id, payload, timestamp }
                      })
                    )
```

#### Transport

Uses the **existing notification SSE channel** (`/api/auth/notifications/stream`). Extended to include app events when `clientBroadcast: true`.

#### Event Declaration Extension

```typescript
// In module's events.ts
const events = [
  {
    id: 'example.todo.created',
    label: 'Todo Created',
    entity: 'todo',
    category: 'crud',
    clientBroadcast: true,  // NEW: bridge this event to the browser
  },
] as const
```

Only events with `clientBroadcast: true` are bridged. Default is `false`.

### 4. `useAppEvent` Hook

```typescript
// packages/ui/src/backend/injection/useAppEvent.ts

function useAppEvent(
  eventPattern: string,           // e.g., 'example.todo.*', '*'
  handler: (payload: AppEventPayload) => void,
  deps?: unknown[],
): void

interface AppEventPayload {
  id: string
  payload: Record<string, unknown>
  timestamp: number
  organizationId: string
}
```

Wildcard matching uses same pattern as server-side event bus:
```typescript
function matchesPattern(pattern: string, eventId: string): boolean {
  if (pattern === '*') return true
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  return regex.test(eventId)
}
```

### 5. Performance & Security

- Events scoped to `organizationId` (SSE channel is already org-scoped)
- Payload limit: 4KB; larger payloads send only entity reference
- Deduplication: 500ms window for identical event IDs
- Opt-in: `clientBroadcast: true` required; default is `false`

---

## Example Module Additions

### Update `example/events.ts`

Add `clientBroadcast: true` to todo CRUD events:

```typescript
const events = [
  {
    id: 'example.todo.created',
    label: 'Todo Created',
    entity: 'todo',
    category: 'crud',
    clientBroadcast: true,  // NEW
  },
  {
    id: 'example.todo.updated',
    label: 'Todo Updated',
    entity: 'todo',
    category: 'crud',
    clientBroadcast: true,  // NEW
  },
  // ... existing events unchanged
] as const
```

### Update `example/widgets/injection/sales-todos/widget.client.tsx`

Replace manual refresh with `useAppEvent`:

```typescript
"use client"
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

export default function SalesTodosWidget({ context, data }: WidgetProps) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useAppEvent('example.todo.*', () => {
    setRefreshKey(k => k + 1)
  })

  useEffect(() => {
    loadTodos(context.record?.id).then(setTodos)
  }, [context.record?.id, refreshKey])

  return <TodoList todos={todos} />
}
```

### Add `example/widgets/injection/crud-validation/widget.ts`

Demonstrate `onFieldChange` — shows warning when todo title contains "TEST":

```typescript
export default {
  metadata: {
    id: 'example.injection.crud-validation',
    features: ['example.view'],
  },
  eventHandlers: {
    onFieldChange: async (fieldId, value, data, context) => {
      if (fieldId === 'title' && typeof value === 'string' && value.includes('TEST')) {
        return {
          message: { text: 'Title contains "TEST" — this may be a test entry', severity: 'warning' },
        }
      }
    },
    // transformFormData: auto-trim whitespace
    transformFormData: async (data, context) => {
      const trimmed = { ...data }
      for (const [key, value] of Object.entries(trimmed)) {
        if (typeof value === 'string') {
          trimmed[key] = value.trim()
        }
      }
      return trimmed
    },
  },
}
```

---

## Integration Tests

### TC-UMES-E01: `clientBroadcast: true` event arrives at client via SSE within 2 seconds

**Type**: API+UI (Playwright)

**Steps**:
1. Open a backend page in the browser (establishes SSE connection)
2. Set up a listener for `om:event` DOM events via `page.evaluate`
3. Create a todo via API (triggers `example.todo.created` event)
4. Wait for the DOM event to fire

**Expected**: The `om:event` CustomEvent fires within 2 seconds with `detail.id === 'example.todo.created'`

**Testing notes**:
- Use `page.evaluate(() => new Promise(resolve => { window.addEventListener('om:event', (e) => resolve(e.detail), { once: true }) }))`
- Race against a 2-second timeout
- Clean up: delete the created todo

### TC-UMES-E02: Widget `onAppEvent` handler fires when matching event is dispatched

**Type**: UI (Playwright)

**Steps**:
1. Navigate to a page with the sales-todos widget (e.g., sales order detail with example widget)
2. Create a todo via API
3. Observe widget refresh (todo count updates without manual refresh)

**Expected**: Widget data refreshes automatically after event fires

### TC-UMES-E03: `onFieldChange` handler receives field updates and can set side-effects

**Type**: UI (Playwright)

**Steps**:
1. Navigate to todo create/edit form
2. Type "TEST item" in the title field
3. Observe the field warning message

**Expected**: A warning message appears: "Title contains TEST — this may be a test entry"

**Testing notes**:
- Locate the title input, type slowly to trigger onChange
- Look for warning badge/message near the field

### TC-UMES-E04: `transformFormData` pipeline applies multiple widget transformations in priority order

**Type**: UI (Playwright)

**Steps**:
1. Navigate to todo create form
2. Enter title with leading/trailing spaces: "  My Todo  "
3. Submit the form
4. Verify the saved todo has trimmed title

**Expected**: Saved todo title is "My Todo" (whitespace trimmed by transformer)

### TC-UMES-E05: Events without `clientBroadcast: true` do NOT arrive at client

**Type**: API+UI (Playwright)

**Steps**:
1. Set up listener for `om:event`
2. Trigger an event that does NOT have `clientBroadcast: true`
3. Wait 3 seconds

**Expected**: No `om:event` fires for the non-broadcast event

### TC-UMES-E06: `useAppEvent` wildcard pattern `example.todo.*` matches `example.todo.created`

**Type**: Unit (Vitest)

**Steps**:
1. Import `matchesPattern` utility
2. Test: `matchesPattern('example.todo.*', 'example.todo.created')` → `true`
3. Test: `matchesPattern('example.todo.*', 'example.item.created')` → `false`
4. Test: `matchesPattern('*', 'anything.here')` → `true`

**Expected**: All pattern matching assertions pass

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/ui/src/backend/injection/useAppEvent.ts` |
| **NEW** | `packages/core/src/modules/example/widgets/injection/crud-validation/widget.ts` |
| **MODIFY** | `packages/shared/src/modules/widgets/injection.ts` (add new event handler types) |
| **MODIFY** | `packages/ui/src/backend/injection/useInjectionSpotEvents.ts` (dual dispatch) |
| **MODIFY** | `packages/core/src/modules/example/events.ts` (add clientBroadcast) |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection/sales-todos/widget.client.tsx` |
| **MODIFY** | SSE notification stream endpoint (add event bridging) |

**Estimated scope**: Large — SSE extension + new event types + dual dispatch

---

## Backward Compatibility

- All existing `WidgetInjectionEventHandlers` remain unchanged
- Delete-to-save fallback chain explicitly preserved
- `onEvent` callback prop union updated to include new event names (additive)
- Events without `clientBroadcast: true` have zero behavior change
- Existing `om:` DOM events (mutation error, sidebar refresh) continue to work alongside the bridge
