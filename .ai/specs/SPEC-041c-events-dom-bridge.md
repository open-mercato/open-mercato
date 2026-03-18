# SPEC-041c — Extended Widget Events + DOM Event Bridge

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | C (PR 3) |
| **Branch** | `feat/umes-event-bridge` |
| **Depends On** | Phase A (Foundation) |
| **Status** | Implemented (2026-02-25; Phase M operation filter remains in SPEC-041m) |

## Goal

Expand widget event handlers with DOM-inspired lifecycle events and transformer pipelines. Bridge server-side app events to the browser so widgets can react instantly without polling.

---

## Scope

### 1. New Widget Event Handlers

```typescript
interface WidgetInjectionEventHandlers<TContext, TData> {
  // === Operation Filter (Phase M) ===
  /** Filter which operations trigger these handlers. Omit for all operations. */
  filter?: WidgetInjectionEventFilter

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

// Phase M addition: operation-level event filtering
interface WidgetInjectionEventFilter {
  /** Only run handlers for these operations. Omit to run for all. */
  operations?: ('create' | 'update' | 'delete')[]
}
```

**Operation Filter** (Phase M): When `filter.operations` is specified, the CrudForm save pipeline checks the current operation (create/update/delete) before invoking each widget's event handlers. Handlers for filtered-out operations are skipped entirely. See [SPEC-041m](./SPEC-041m-mutation-lifecycle.md) for the full pipeline and filtering details.

### 2. Dual-Mode Event Dispatch

The existing `triggerEvent` function dispatches **action events** (fire handler, accumulate `requestHeaders`, check `ok` boolean). Transformer events require a **pipeline** dispatch (output of widget N becomes input of widget N+1).

```typescript
// Existing behavior — unchanged for action events (with operation filter check)
if (isActionEvent(event)) {
  // Current logic: iterate widgets, accumulate requestHeaders, check ok
  // Phase M addition: skip widget if filter.operations excludes current operation
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

### 3. CrudForm Emission Toggle

CrudForm automatic emission of Phase C extended events is controlled by:

```bash
NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED=true
```

- Default: `true`
- When `false`, CrudForm skips automatic emission for:
  - `onFieldChange`
  - `onBeforeNavigate`
  - `onVisibilityChange`
  - `onAppEvent`
  - `transformFormData`
  - `transformDisplayData`
  - `transformValidation`
- Core save/delete lifecycle handlers remain unchanged.

### 4. DOM Event Bridge

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

Uses the dedicated SSE channel at `/api/events/stream`. It bridges only events marked with `clientBroadcast: true`.

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

### 5. `useAppEvent` Hook

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

### 6. Async Operation Progress Pattern

Long-running operations (data sync imports, bulk exports, webhook replay) need real-time progress tracking within widgets. This pattern leverages the DOM Event Bridge to deliver structured progress events.

#### Standard Progress Event Contract

```typescript
// packages/shared/src/modules/widgets/injection-progress.ts

interface OperationProgressEvent {
  operationId: string         // Unique operation ID (e.g., syncRunId)
  operationType: string       // e.g., 'sync.import', 'bulk.export', 'webhook.replay'
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number            // 0-100
  processedCount: number
  totalCount: number
  currentStep?: string        // Human-readable step name
  errors: number
  startedAt: number           // timestamp
  metadata?: Record<string, unknown>
}
```

Server-side workers emit progress via standard events with `clientBroadcast: true`:

```typescript
// In module's events.ts
{
  id: 'integration.sync.progress',
  label: 'Sync Progress Update',
  entity: 'sync_run',
  category: 'system',
  clientBroadcast: true,  // Bridges to browser via SSE
}
```

#### `useOperationProgress` Hook

```typescript
// packages/ui/src/backend/injection/useOperationProgress.ts

function useOperationProgress(
  operationPattern: string,     // e.g., 'integration.sync.progress'
  operationId?: string,         // Filter to specific operation (optional)
): {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number              // 0-100
  processedCount: number
  totalCount: number
  currentStep?: string
  errors: number
  startedAt?: number
  elapsedMs: number
}
```

The hook listens to `om:event` DOM events matching the pattern and aggregates state. When `operationId` is provided, only events for that operation are tracked.

#### Usage Example — Data Sync Widget

```typescript
"use client"
import { useOperationProgress } from '@open-mercato/ui/backend/injection/useOperationProgress'

export default function SyncStatusWidget({ context }: WidgetProps) {
  const progress = useOperationProgress('integration.sync.progress', context.record?.activeSyncRunId)

  if (progress.status === 'idle') return <Badge>No active sync</Badge>

  return (
    <div>
      <ProgressBar value={progress.progress} />
      <span>{progress.processedCount} / {progress.totalCount} records</span>
      {progress.currentStep && <span>Step: {progress.currentStep}</span>}
      {progress.errors > 0 && <Badge variant="error">{progress.errors} errors</Badge>}
    </div>
  )
}
```

#### Worker-Side Emission

Workers emit progress at regular intervals (every batch or every N records):

```typescript
// In sync worker
await emitEvent('integration.sync.progress', {
  operationId: syncRunId,
  operationType: 'sync.import',
  status: 'running',
  progress: Math.round((processed / total) * 100),
  processedCount: processed,
  totalCount: total,
  currentStep: 'Importing products',
  errors: failedCount,
  startedAt,
})
```

**Throttling**: Progress events are throttled server-side (max 1 per second per operation) to avoid overwhelming the SSE channel. The 4KB payload limit (from existing SSE bridge) is sufficient for progress payloads.

### 6. Performance & Security

- Events MUST be server-filtered by audience before SSE send (tenant + organization + recipient user/role)
- Payload limit: 4KB; larger payloads send a truncated entity reference payload
- Deduplication: 500ms window for identical event+payload fingerprints
- Opt-in: `clientBroadcast: true` required; default is `false`

### 7. Audience Filtering Contract (Mandatory)

`clientBroadcast: true` events are treated as potentially sensitive and MUST be filtered server-side in `packages/events/src/modules/events/api/stream/route.ts`.
Client-side filtering (`useAppEvent`) is optional defense-in-depth only and MUST NOT be the primary access control.

#### Supported audience fields in event payload

```typescript
interface BroadcastAudience {
  tenantId: string                           // required for broadcast
  organizationId?: string | null             // single org scope
  organizationIds?: string[]                 // multi-org scope
  recipientUserId?: string                   // single recipient user
  recipientUserIds?: string[]                // multiple recipient users
  recipientRoleId?: string                   // single recipient role
  recipientRoleIds?: string[]                // multiple recipient roles
}
```

#### Server-side matching rules

1. `tenantId` MUST match connection tenant exactly; if missing, drop event.
2. If event has `organizationId`/`organizationIds`, connection organization MUST match one of them; if connection has no organization selected, drop org-scoped event.
3. If event has `recipientUserId`/`recipientUserIds`, connection `userId` MUST match one of them.
4. If event has `recipientRoleId`/`recipientRoleIds`, connection role set MUST intersect the event role set.
5. When multiple audience dimensions are present, treat them as logical AND.
6. If no recipient field exists, event is tenant/org broadcast within allowed scope.

#### Security requirement

An authenticated user MUST NOT receive `om:event` payloads for another user/role/organization. "Receive then ignore on client" is not acceptable for notification-like events.

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

### TC-UMES-E07: `onBeforeNavigate` blocks restricted targets and allows valid targets

**Type**: UI (Playwright)

**Steps**:
1. Open `/backend/umes-handlers` (Phase C test harness)
2. Set target to `/backend/blocked` and trigger `onBeforeNavigate`
3. Set target to `/backend/todos` and trigger `onBeforeNavigate` again

**Expected**:
- First run returns `{ ok: false, message: "Navigation blocked..." }`
- Second run returns `{ ok: true }`

### TC-UMES-E08: `onVisibilityChange` persists visibility transitions

**Type**: UI (Playwright)

**Steps**:
1. Open `/backend/umes-handlers`
2. Toggle visibility off, then on
3. Verify the widget state reflects the latest `visible` value

**Expected**: Shared widget state records visibility changes; final state is `visible: true`

### TC-UMES-E09: `onAppEvent` receives bridged app event payload

**Type**: UI (Playwright)

**Steps**:
1. Open `/backend/umes-handlers`
2. Dispatch a mock `om:event` with `id: "example.todo.created"`
3. Verify widget `onAppEvent` state updates

**Expected**: Captured event id equals `example.todo.created`

### TC-UMES-E10: `transformDisplayData` and `transformValidation` pipelines mutate output

**Type**: UI (Playwright)

**Steps**:
1. Open `/backend/umes-handlers`
2. Trigger `transformDisplayData` for title `display me`
3. Trigger `transformValidation` for `{ title: "Title is required" }`

**Expected**:
- Display data title is transformed to `DISPLAY ME`
- Validation output title is prefixed with `[widget]`

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

### TC-UMES-E11: Cross-user recipient isolation

**Type**: API+UI (Playwright)

**Steps**:
1. Open two browser contexts in same tenant and organization (User A, User B)
2. Emit a `clientBroadcast: true` event with `recipientUserId = UserA`
3. Listen for `om:event` in both contexts

**Expected**:
- User A receives event
- User B does not receive event payload at all

### TC-UMES-E12: Role-based recipient isolation

**Type**: API+UI (Playwright)

**Steps**:
1. Open two users in same tenant/org with non-overlapping roles
2. Emit event with `recipientRoleIds` containing only Role X
3. Listen for `om:event` in both contexts

**Expected**:
- User with Role X receives event
- User without Role X does not receive event

### TC-UMES-E13: Organization hard boundary

**Type**: API+UI (Playwright)

**Steps**:
1. Open two users in same tenant but different selected organizations
2. Emit event scoped to Organization A
3. Listen for `om:event` in both contexts

**Expected**:
- User in Organization A receives event
- User in Organization B does not receive event

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/ui/src/backend/injection/useAppEvent.ts` |
| **NEW** | `packages/ui/src/backend/injection/useOperationProgress.ts` |
| **NEW** | `packages/shared/src/modules/widgets/injection-progress.ts` |
| **NEW** | `packages/core/src/modules/example/widgets/injection/crud-validation/widget.ts` |
| **MODIFY** | `packages/ui/src/backend/CrudForm.tsx` (extended event emission + env toggle) |
| **MODIFY** | `apps/mercato/.env.example` (`NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED`) |
| **MODIFY** | `packages/shared/src/modules/widgets/injection.ts` (add new event handler types) |
| **MODIFY** | `packages/ui/src/backend/injection/InjectionSpot.tsx` (dual dispatch in `useInjectionSpotEvents`) |
| **MODIFY** | `packages/core/src/modules/example/events.ts` (add clientBroadcast) |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection/sales-todos/widget.client.tsx` |
| **MODIFY** | `packages/core/src/modules/notifications/api/stream/route.ts` (NEW stream endpoint for event bridging) |

**Estimated scope**: Large — SSE extension + new event types + dual dispatch

---

## Backward Compatibility

- All existing `WidgetInjectionEventHandlers` remain unchanged (new `filter` field is optional — Phase M)
- Delete-to-save fallback chain explicitly preserved
- `onEvent` callback prop union updated to include new event names (additive)
- Events without `clientBroadcast: true` have zero behavior change
- Existing `om:` DOM events (mutation error, sidebar refresh) continue to work alongside the bridge

## Implementation Notes (2026-02-25)

### SSE Endpoint
- Implemented at `packages/events/src/modules/events/api/stream/route.ts`
- Uses `ReadableStream` with SSE format (`text/event-stream`)
- Heartbeat every 30s (`:heartbeat\n\n`)
- Global connection registry pattern: single `*` event bus handler broadcasts to all SSE connections
- Connection context MUST include `tenantId`, `organizationId`, `userId`, and `roleIds`
- Server-side audience filtering MUST enforce tenant + organization + recipient user/role checks before enqueueing event to stream
- Max payload: 4096 bytes per event

### Audience Filtering (Implemented)
- Implemented in `packages/events/src/modules/events/api/stream/route.ts` with `normalizeAudience()` + `matchesAudience()`
- Supported payload fields:
  - `tenantId` (required for delivery)
  - `organizationId` / `organizationIds`
  - `recipientUserId` / `recipientUserIds`
  - `recipientRoleId` / `recipientRoleIds`
- Match semantics:
  - Tenant must match exactly
  - Organization, when provided, must match the selected org on the SSE connection
  - Recipient user, when provided, must include connection user
  - Recipient role, when provided, must intersect connection role set
  - Multiple audience dimensions are AND-combined

### Client-Side
- `eventBridge.ts` — `useEventBridge()` hook with auto-reconnect (exponential backoff, 1s–30s)
- `useAppEvent.ts` — wildcard pattern matching using regex (`*` → `.*`)
- `useOperationProgress.ts` — tracks async operation status with elapsed time ticker
- Events dispatched as `om:event` CustomEvents on `window`
- 500ms deduplication window on client

### Widget Event Dispatch
- Dual-mode dispatch in `InjectionSpot.tsx`:
  - **Transformer events** (`transformFormData`, `transformDisplayData`, `transformValidation`): pipeline where output of widget N flows to widget N+1
  - **Action events** (`onFieldChange`, `onBeforeNavigate`, `onVisibilityChange`, `onAppEvent`): fire-and-forget, results accumulated
- `TRANSFORMER_EVENTS` Set classifies event types
- New event arguments passed via `meta` parameter
- CrudForm emission gate: `NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED` (default `true`)

### Files Created/Modified
- `packages/shared/src/modules/widgets/injection.ts` — new event handler types
- `packages/shared/src/modules/events/types.ts` — `clientBroadcast` field
- `packages/shared/src/modules/widgets/injection-progress.ts` — OperationProgressEvent type
- `packages/ui/src/backend/injection/useAppEvent.ts`
- `packages/ui/src/backend/injection/useOperationProgress.ts`
- `packages/ui/src/backend/injection/eventBridge.ts`
- `packages/ui/src/backend/injection/InjectionSpot.tsx` — dual-mode dispatch
- `packages/events/src/modules/events/api/stream/route.ts` — SSE endpoint
- `packages/shared/src/modules/events/factory.ts` — `isBroadcastEvent()` helper
- `apps/mercato/src/modules/example/api/assignees/route.ts` — test-only SSE probe emitter used by integration coverage
- `apps/mercato/src/modules/example/__integration__/TC-UMES-003.spec.ts` — TC-UMES-E12/E13/E14 audience isolation coverage

## Changelog

- 2026-02-25: Added mandatory server-side audience filtering contract (tenant/org/user/role), added negative isolation integration coverage requirements (E11-E13), and aligned implementation notes with `/api/events/stream`.
