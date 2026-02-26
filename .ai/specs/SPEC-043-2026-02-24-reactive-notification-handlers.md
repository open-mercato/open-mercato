# SPEC-043 — Reactive Notification Handlers

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Related** | SPEC-041 (Universal Module Extension System), SPEC-003 (Notifications Module), SPEC-005 (Record Locking Module) |

## TLDR

Introduce **Reactive Notification Handlers** — client-side handlers that execute code automatically when a notification of a specific type arrives, regardless of whether the user has opened the notification panel or read the notification. This turns notifications from a passive "inbox" model into an active "event bus" model on the client, enabling modules to react to server-side events in real time (popups, toasts, state refreshes, data reloads) without writing custom polling loops. Integrates with UMES (SPEC-041) as a new extension point type: `notification:<type>:handler`.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Notification Handler Contract](#4-notification-handler-contract)
5. [Handler Registration & Discovery](#5-handler-registration--discovery)
6. [Client-Side Dispatch Runtime](#6-client-side-dispatch-runtime)
7. [Built-in Handler Effects](#7-built-in-handler-effects)
8. [Eliminating Module-Specific Polling](#8-eliminating-module-specific-polling)
9. [UMES Integration](#9-umes-integration)
10. [Server-Sent Events Upgrade Path](#10-server-sent-events-upgrade-path)
11. [Data Models](#11-data-models)
12. [API Contracts](#12-api-contracts)
13. [Developer Experience](#13-developer-experience)
14. [Risks & Impact Review](#14-risks--impact-review)
15. [Integration Test Coverage](#15-integration-test-coverage)
16. [Changelog](#16-changelog)

---

## 1. Problem Statement

### Current State

Open Mercato's notification system is **passive** — notifications are created on the server, stored in the database, and polled every 5 seconds by `useNotificationsPoll`. Users see them in the notification panel. The system supports custom renderers for rich display and declarative actions (links, buttons), but there is no mechanism for a notification to **do something** when it arrives on the client.

### Problems

1. **No client-side reactions** — When a notification arrives, nothing happens unless the user opens the notification panel. Modules that need real-time client-side effects (show a popup, refresh a data table, update a form field) have no way to hook into notification arrival.

2. **Module-specific polling proliferation** — The record_locks module runs **four separate polling loops** (contention sync every 5s, record-deleted sync every 5s, heartbeat every 4s, lock heartbeat every 10-15s) that query `/api/notifications?type=record_locks.*` to detect state changes. Each new module that needs real-time awareness copies this pattern, multiplying HTTP requests.

3. **No generic "wait for notification" primitive** — When a module needs to wait for a specific server-side event (e.g., "wait until the other user releases the lock"), there's no generic mechanism. Each module builds its own polling + state matching logic.

4. **Notifications are display-only** — The `NotificationTypeDefinition` supports `actions` (user-clickable buttons) and `Renderer` (custom display component), but has no concept of "auto-execute this when the notification arrives." A module cannot say "when `record_locks.conflict.resolved` arrives, automatically dismiss the conflict banner and refresh the form."

5. **Toast/popup gap** — Some notifications should trigger an immediate, attention-grabbing toast or popup (e.g., "Your record was force-released by admin"), but the current system only shows a subtle badge pulse on the bell icon. Modules resort to custom UI injection to achieve this.

### Goal

Create a typed, declarative system where modules register **handlers** that execute automatically when notifications of specific types arrive on the client — enabling popups, toasts, data refreshes, state updates, and custom effects — while eliminating the need for module-specific polling loops.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Handlers are side-effects, not transforms** | Handlers react to notifications; they don't modify notification content. This keeps the notification data pipeline clean. |
| 2 | **Declarative registration, imperative execution** | Modules declare which types they handle; handler code runs imperatively when triggered. Same pattern as UMES widgets. |
| 3 | **Handlers run regardless of read status** | A notification handler fires when the notification arrives on the client, not when the user reads it. This is the key differentiator from actions. |
| 4 | **Multiple handlers per type** | Different modules can register handlers for the same notification type. All handlers execute (no short-circuiting). |
| 5 | **Handlers are idempotent** | The polling model means the same notification may be seen multiple times. Handlers must be idempotent or the runtime must track "already handled" state. |
| 6 | **Progressive enhancement** | Existing notifications work exactly as before. Handlers are opt-in per type. |
| 7 | **UMES-native** | Handlers are a new UMES extension point type, following the same registration, discovery, and ACL patterns. |

---

## 3. Architecture Overview

```
Server-Side                                    Client-Side
──────────                                     ───────────

Domain Event                                   Notification Poll (5s)
    │                                               │
    ▼                                               ▼
Event Subscriber                               useNotificationsPoll
    │                                               │
    ▼                                               ▼
NotificationService.create()                   New notifications detected
    │                                               │
    ▼                                               ▼
Database (notifications table)                 NotificationDispatcher
                                                    │
                                         ┌──────────┼──────────┐
                                         ▼          ▼          ▼
                                      Handler A  Handler B  Handler C
                                      (toast)    (refresh)  (popup)
                                         │          │          │
                                         ▼          ▼          ▼
                                      Show toast  Reload     Open
                                      message     DataTable  dialog
```

The **NotificationDispatcher** is the new runtime component. It sits between the notification poll and the handler registry. When a new notification arrives that hasn't been dispatched before, it looks up all registered handlers for that notification type, checks ACL gates, and executes them.

---

## 4. Notification Handler Contract

### 4.1 Core Type

```typescript
// packages/shared/src/modules/notifications/handler.ts

interface NotificationHandler {
  /** Unique handler ID (module-scoped) */
  id: string
  /** Notification type(s) to handle. Supports exact match and wildcards. */
  notificationType: string | string[]
  /** ACL features required for this handler to activate */
  features?: string[]
  /** Priority (higher = runs first). Default: 50 */
  priority?: number
  /**
   * Execute when a notification of the matching type arrives on the client.
   * Called once per notification (idempotency guaranteed by the dispatcher).
   * Receives the full notification DTO and a context with effect helpers.
   */
  handle(notification: NotificationDto, context: HandlerContext): void | Promise<void>
}
```

### 4.2 Handler Context

The handler context provides typed helpers for common effects, so modules don't need to import UI primitives directly:

```typescript
interface HandlerContext {
  /** Current user's ID */
  userId: string
  /** Current user's ACL features */
  features: string[]
  /** Current page path (e.g., '/backend/sales/orders/123') */
  currentPath: string

  // === Effect Helpers ===

  /** Show a toast notification (non-blocking, auto-dismissing) */
  toast(options: ToastOptions): void
  /** Show a persistent popup/dialog that requires user action */
  popup(options: PopupOptions): void
  /** Emit a DOM event (for cross-component communication) */
  emitEvent(eventName: string, detail?: unknown): void
  /** Refresh the notification poll immediately */
  refreshNotifications(): void
  /** Navigate to a URL */
  navigate(href: string): void
  /** Mark this notification as read (without user interaction) */
  markAsRead(notificationId: string): Promise<void>
  /** Dismiss this notification (without user interaction) */
  dismiss(notificationId: string): Promise<void>
}

interface ToastOptions {
  title: string
  body?: string
  severity?: NotificationSeverity
  duration?: number        // ms, default 5000
  action?: {
    label: string
    onClick: () => void
  }
}

interface PopupOptions {
  title: string
  body: string | React.ReactNode
  severity?: NotificationSeverity
  /** Actions shown as buttons in the popup */
  actions?: PopupAction[]
  /** If true, popup cannot be dismissed by clicking outside */
  modal?: boolean
  /** Auto-dismiss after N ms (0 = never) */
  autoCloseMs?: number
}

interface PopupAction {
  label: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  onClick: () => void
}
```

### 4.3 Wildcard Matching

Handlers can target notification types with wildcards:

```typescript
// Exact match
notificationType: 'record_locks.conflict.detected'

// Multiple exact types
notificationType: ['record_locks.conflict.detected', 'record_locks.conflict.resolved']

// Wildcard — all record_locks notifications
notificationType: 'record_locks.*'

// Wildcard — all notifications (global handler)
notificationType: '*'
```

Wildcard resolution follows the same rules as UMES spot ID wildcards (SPEC-041 Section 4.2).

---

## 5. Handler Registration & Discovery

### 5.1 Module File Convention

Handlers are declared in a new auto-discovered file:

```
src/modules/<module>/
├── notifications.ts          # Existing: type definitions
├── notifications.client.ts   # Existing: client types + renderers
└── notifications.handlers.ts # NEW: reactive handlers
```

### 5.2 File Contract

```typescript
// src/modules/record_locks/notifications.handlers.ts

import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'record_locks.conflict-detected-popup',
    notificationType: 'record_locks.conflict.detected',
    features: ['record_locks.view'],
    priority: 100,
    handle(notification, ctx) {
      // Only show popup if user is currently editing the conflicting record
      const resourceId = notification.bodyVariables?.resourceId
      if (!resourceId || !ctx.currentPath.includes(resourceId)) return

      ctx.popup({
        title: 'Conflict Detected',
        body: `Another user modified ${notification.bodyVariables?.resourceKind ?? 'this record'} while you were editing it.`,
        severity: 'warning',
        actions: [
          {
            label: 'Review Changes',
            variant: 'default',
            onClick: () => ctx.navigate(notification.linkHref ?? ctx.currentPath),
          },
          {
            label: 'Dismiss',
            variant: 'ghost',
            onClick: () => ctx.dismiss(notification.id),
          },
        ],
      })
    },
  },
  {
    id: 'record_locks.force-released-toast',
    notificationType: 'record_locks.lock.force_released',
    features: ['record_locks.view'],
    handle(notification, ctx) {
      ctx.toast({
        title: 'Lock Released',
        body: 'An administrator force-released your lock on this record.',
        severity: 'warning',
        duration: 8000,
      })
      // Emit event so the record-lock widget can update its state
      ctx.emitEvent('om:record-locks:force-released', {
        resourceId: notification.bodyVariables?.resourceId,
      })
    },
  },
  {
    id: 'record_locks.incoming-changes-refresh',
    notificationType: 'record_locks.incoming_changes.available',
    features: ['record_locks.view'],
    handle(notification, ctx) {
      // Emit event that the record lock widget listens to
      ctx.emitEvent('om:record-locks:incoming-changes', {
        resourceId: notification.bodyVariables?.resourceId,
        changedRowsJson: notification.bodyVariables?.changedRowsJson,
        incomingActionLogId: notification.sourceEntityId,
      })
    },
  },
]
```

### 5.3 Auto-Discovery

The CLI generator (`yarn generate`) discovers `notifications.handlers.ts` files and generates a handler registry in `apps/mercato/.mercato/generated/notification-handlers.ts`:

```typescript
// AUTO-GENERATED — do not edit
import { notificationHandlers as recordLocksHandlers } from '../../packages/enterprise/src/modules/record_locks/notifications.handlers'
import { notificationHandlers as salesHandlers } from '../../packages/core/src/modules/sales/notifications.handlers'

export const allNotificationHandlers = [
  ...recordLocksHandlers,
  ...salesHandlers,
]
```

---

## 6. Client-Side Dispatch Runtime

### 6.1 NotificationDispatcher

The dispatcher is a singleton that integrates with `useNotificationsPoll`:

```typescript
// packages/ui/src/backend/notifications/NotificationDispatcher.ts

class NotificationDispatcher {
  private handlers: NotificationHandler[] = []
  private handledSet = new Set<string>()  // notification IDs already dispatched

  register(handlers: NotificationHandler[]): void {
    this.handlers = handlers.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50))
  }

  /**
   * Called by useNotificationsPoll when new notifications arrive.
   * Dispatches to matching handlers exactly once per notification.
   */
  dispatch(notifications: NotificationDto[], context: HandlerContext): void {
    for (const notification of notifications) {
      if (this.handledSet.has(notification.id)) continue

      const matchingHandlers = this.handlers.filter(
        (h) => this.matchesType(h.notificationType, notification.type)
          && this.matchesFeatures(h.features, context.features)
      )

      for (const handler of matchingHandlers) {
        try {
          handler.handle(notification, context)
        } catch (error) {
          console.error(`[NotificationDispatcher] Handler ${handler.id} failed:`, error)
        }
      }

      this.handledSet.add(notification.id)
    }
  }

  /** Prevent unbounded memory growth — prune IDs older than 500 entries */
  prune(): void {
    if (this.handledSet.size > 500) {
      const entries = [...this.handledSet]
      const toRemove = entries.slice(0, entries.length - 200)
      toRemove.forEach((id) => this.handledSet.delete(id))
    }
  }

  private matchesType(pattern: string | string[], type: string): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    return patterns.some((p) => {
      if (p === '*') return true
      if (p.endsWith('.*')) return type.startsWith(p.slice(0, -1))
      return p === type
    })
  }

  private matchesFeatures(required: string[] | undefined, current: string[]): boolean {
    if (!required || required.length === 0) return true
    return required.every((f) => current.includes(f))
  }
}
```

### 6.2 Integration with useNotificationsPoll

The existing poll hook gains a single new behavior — when new notifications are detected, it passes them to the dispatcher:

```typescript
// In useNotificationsPoll.ts — addition

const dispatcher = useNotificationDispatcher()

// Inside fetchNotifications, after setting new notifications:
if (newNotifications.length > 0 && dispatcher) {
  dispatcher.dispatch(newNotifications, handlerContext)
}
```

### 6.3 Provider Component

A provider at the app shell level initializes the dispatcher with the generated handler registry:

```typescript
// packages/ui/src/backend/notifications/NotificationHandlerProvider.tsx

export function NotificationHandlerProvider({
  handlers,
  children,
}: {
  handlers: NotificationHandler[]
  children: React.ReactNode
}) {
  const dispatcherRef = React.useRef(new NotificationDispatcher())

  React.useEffect(() => {
    dispatcherRef.current.register(handlers)
  }, [handlers])

  return (
    <NotificationDispatcherContext.Provider value={dispatcherRef.current}>
      {children}
    </NotificationDispatcherContext.Provider>
  )
}
```

### 6.4 Idempotency Guarantee

The `handledSet` tracks notification IDs that have already been dispatched. Since the 5-second poll may return the same notification multiple times (until it's read/dismissed), the dispatcher ensures handlers fire exactly once per notification per browser session.

On page navigation (SPA), the `handledSet` persists (it's in the provider's ref). On full page reload, it resets — but this is acceptable because:
- Handlers are side-effects (toasts, popups) that make sense to re-fire after a reload
- Handlers that update local state (like record lock store) are idempotent by design
- The `handledSet` prunes to prevent memory growth

---

## 7. Built-in Handler Effects

### 7.1 Toast

Toasts use the existing flash message system (`useFlash` / `showFlash`) but are triggered programmatically:

```typescript
ctx.toast({
  title: 'Order Assigned',
  body: 'A new order has been assigned to you.',
  severity: 'info',
  duration: 5000,
  action: {
    label: 'View Order',
    onClick: () => ctx.navigate('/backend/sales/orders/123'),
  },
})
```

### 7.2 Popup

Popups render a modal dialog via a global popup stack managed by the `NotificationHandlerProvider`:

```typescript
ctx.popup({
  title: 'Record Locked',
  body: 'This record is being edited by another user.',
  severity: 'warning',
  modal: true,
  actions: [
    { label: 'Wait', variant: 'outline', onClick: () => {} },
    { label: 'Force Edit', variant: 'destructive', onClick: () => forceLock() },
  ],
})
```

The popup stack ensures multiple simultaneous popups are queued and shown one at a time.

### 7.3 DOM Event Emission

For cross-component communication, handlers can emit typed DOM events:

```typescript
ctx.emitEvent('om:record-locks:incoming-changes', {
  resourceId: '...',
  changedRowsJson: '...',
})
```

Other components subscribe to these events using standard DOM `addEventListener` or the existing `subscribeNotificationNew`-style helpers. This bridges the notification system with widget-level reactivity.

### 7.4 The `useNotificationEffect` Hook

For components that need to react to specific notification types without registering a global handler, provide a lightweight hook:

```typescript
// packages/ui/src/backend/notifications/useNotificationEffect.ts

function useNotificationEffect(
  notificationType: string | string[],
  effect: (notification: NotificationDto) => void,
  deps?: React.DependencyList
): void
```

Usage:

```typescript
// In a record-lock widget component
useNotificationEffect(
  'record_locks.conflict.resolved',
  (notification) => {
    if (notification.bodyVariables?.resourceId === currentResourceId) {
      setConflictState(null)
      refreshForm()
    }
  },
  [currentResourceId]
)
```

This hook subscribes to the dispatcher for the component's lifetime and unsubscribes on unmount. It is a convenience for component-scoped reactions — for module-level handlers, use `notifications.handlers.ts`.

---

## 8. Eliminating Module-Specific Polling

### 8.1 Record Locks: Before and After

**Before** (current — 4 polling loops):

```
┌─ Poll /api/notifications?type=record_locks.lock.contended  (5s)
├─ Poll /api/notifications?type=record_locks.record.deleted   (5s)
├─ Poll heartbeat/presence                                     (4s)
└─ Poll lock heartbeat                                         (10-15s)
```

**After** (with reactive handlers):

```
┌─ Notification handler: record_locks.lock.contended → emit DOM event
├─ Notification handler: record_locks.record.deleted → emit DOM event
├─ Notification handler: record_locks.incoming_changes.available → emit DOM event
├─ Notification handler: record_locks.lock.force_released → toast + emit DOM event
├─ Notification handler: record_locks.conflict.detected → popup + emit DOM event
└─ Poll heartbeat/presence (4s) — KEPT (heartbeat is not notification-driven)
└─ Poll lock heartbeat (10-15s) — KEPT (server-side liveness, not notification)
```

The two notification-specific polls (`lock.contended` and `record.deleted`) are **eliminated**. The record lock widget subscribes to DOM events emitted by the handlers instead of polling the API directly.

The heartbeat/presence polls remain because they serve a different purpose (keep-alive, not notification consumption).

### 8.2 Generic "Wait for Notification" Pattern

Instead of building custom polling loops, modules can use `useNotificationEffect` to wait for a specific notification:

```typescript
// Wait for lock release before showing "edit available" banner
useNotificationEffect(
  'record_locks.lock.force_released',
  (notification) => {
    if (notification.bodyVariables?.resourceId === resourceId) {
      setEditAvailable(true)
    }
  },
  [resourceId]
)
```

This replaces the pattern of polling `/api/notifications?type=X` in a `setInterval`.

### 8.3 Migration Path

Modules can migrate incrementally:

1. **Phase 1**: Add `notifications.handlers.ts` with handlers that emit DOM events
2. **Phase 2**: Update client widgets to subscribe to DOM events instead of polling
3. **Phase 3**: Remove the polling `setInterval` calls
4. **Phase 4**: Verify behavior with integration tests

No database changes. No API changes. Purely client-side refactoring.

---

## 9. UMES Integration

### 9.1 Extension Point Taxonomy

Notification handlers fit the UMES extension point model as a new category:

```
notification:<type>:handler
```

Examples:
- `notification:record_locks.conflict.detected:handler`
- `notification:sales.order.created:handler`
- `notification:*:handler` — global handler

### 9.2 Extension Registry Entry

Handlers are registered in the UMES extension registry alongside enrichers, interceptors, and widget injections:

```typescript
// Generated extension manifest entry
{
  type: 'notification-handler',
  id: 'record_locks.conflict-detected-popup',
  module: 'record_locks',
  target: 'notification:record_locks.conflict.detected:handler',
  features: ['record_locks.view'],
  priority: 100,
}
```

### 9.3 DevTools Integration

The UMES DevTools panel (SPEC-041 Section 12.2) shows notification handlers alongside other extension types:

- Which handlers are registered for each notification type
- Real-time handler execution log (handler X fired for notification Y)
- Handler execution timing
- Failed handler errors

### 9.4 Feature-Gated Activation

Same ACL integration as all UMES extensions — handlers only activate when the current user has the required features.

### 9.5 Priority & Ordering

When multiple handlers target the same notification type, they execute in priority order (highest first). A handler cannot prevent other handlers from executing (no short-circuiting) — all matching handlers always run.

---

## 10. Server-Sent Events Upgrade Path

### 10.1 Current: Polling

Today, the notification poll runs every 5 seconds. This introduces up to 5 seconds of latency between notification creation and handler execution. For most use cases (order assigned, quote expiring), this is acceptable.

### 10.2 Future: SSE Channel

The architecture is designed so that the polling transport can be replaced with Server-Sent Events (SSE) without changing any handler code:

```
Server                                    Client
──────                                    ──────
NotificationService.create()
    │
    ▼
SSE Channel push                     →    NotificationDispatcher.dispatch()
    (replaces 5s poll)                         │
                                               ▼
                                          Handlers execute immediately
```

**What changes**: The transport layer (poll → SSE). **What stays the same**: Handler registration, handler contracts, dispatch logic, effect helpers.

This is a future enhancement, not part of this spec. The polling model is sufficient for initial implementation.

### 10.3 Hybrid Approach

During migration, both transports can coexist:
- SSE delivers real-time notifications for connected clients
- Polling catches any missed notifications (SSE reconnect gaps)
- The dispatcher's `handledSet` prevents duplicate handler execution

---

## 11. Data Models

### 11.1 No New Database Entities

Reactive notification handlers are purely client-side. No database schema changes are required. Handlers operate on the existing `NotificationDto` structure.

### 11.2 Type Additions

New types added to `packages/shared/src/modules/notifications/`:

```typescript
// handler.ts — NEW file
export interface NotificationHandler { ... }     // Section 4.1
export interface HandlerContext { ... }           // Section 4.2
export interface ToastOptions { ... }            // Section 4.2
export interface PopupOptions { ... }            // Section 4.2
export interface PopupAction { ... }             // Section 4.2
```

### 11.3 New Module File Convention

```
src/modules/<module>/notifications.handlers.ts   # NEW auto-discovered file
```

Export: `notificationHandlers: NotificationHandler[]`

---

## 12. API Contracts

### 12.1 No New API Endpoints

This feature is entirely client-side. No new HTTP endpoints are required.

### 12.2 Existing API Usage

Handlers interact with existing APIs through the `HandlerContext`:

| Context Method | API Call |
|---------------|----------|
| `markAsRead(id)` | `PUT /api/notifications/{id}/read` |
| `dismiss(id)` | `PUT /api/notifications/{id}/dismiss` |
| `refreshNotifications()` | Re-triggers the poll (`GET /api/notifications`) |

---

## 13. Developer Experience

### 13.1 CLI Scaffolding

```bash
# Scaffold a notification handler file for a module
yarn generate notification-handler --module record_locks

# Generates: src/modules/record_locks/notifications.handlers.ts
# with boilerplate and typed imports
```

### 13.2 Example: Adding a Toast for New Orders

Minimal example — a module wants to show a toast when an order is created:

```typescript
// src/modules/sales/notifications.handlers.ts

import type { NotificationHandler } from '@open-mercato/shared/modules/notifications/handler'

export const notificationHandlers: NotificationHandler[] = [
  {
    id: 'sales.order-created-toast',
    notificationType: 'sales.order.created',
    features: ['sales.orders.view'],
    handle(notification, ctx) {
      ctx.toast({
        title: notification.title,
        severity: 'success',
        duration: 5000,
        action: notification.linkHref
          ? { label: 'View', onClick: () => ctx.navigate(notification.linkHref!) }
          : undefined,
      })
    },
  },
]
```

That's it. No polling loops, no provider wrapping, no custom state management.

### 13.3 Example: Conditional Popup Based on Current Page

```typescript
{
  id: 'record_locks.conflict-popup',
  notificationType: 'record_locks.conflict.detected',
  handle(notification, ctx) {
    const resourceId = notification.bodyVariables?.resourceId
    // Only show popup if user is on the affected record's page
    if (resourceId && ctx.currentPath.includes(resourceId)) {
      ctx.popup({
        title: 'Conflict Detected',
        body: 'Another user saved changes to this record.',
        severity: 'warning',
        actions: [
          { label: 'Refresh', onClick: () => window.location.reload() },
          { label: 'Ignore', variant: 'ghost', onClick: () => {} },
        ],
      })
    }
  },
}
```

### 13.4 Example: useNotificationEffect in a Component

```typescript
function OrderDashboard() {
  const [newOrderCount, setNewOrderCount] = useState(0)

  useNotificationEffect(
    'sales.order.created',
    () => setNewOrderCount((prev) => prev + 1),
    []
  )

  return <Badge>{newOrderCount} new orders</Badge>
}
```

---

## 14. Risks & Impact Review

### 14.1 Performance

| Concern | Mitigation |
|---------|------------|
| Handler execution blocks the poll cycle | Handlers run asynchronously (fire-and-forget). Errors are caught and logged, never propagating to the poll. |
| Memory growth from `handledSet` | Pruned to 200 entries when exceeding 500. Worst case: ~200 string IDs in memory (~10KB). |
| Multiple handlers for same type create UI noise | Handlers can check `ctx.currentPath` to filter. DevTools shows which handlers fired. Document best practices for conditional execution. |

### 14.2 Security

| Concern | Mitigation |
|---------|------------|
| Handler executes code from notification data | Handlers are module code, not user content. `notification.bodyVariables` is treated as data, never `eval`'d. |
| Cross-tenant notification leaks | Unchanged — notification API already filters by tenant. Handlers receive only notifications for the current user. |
| ACL bypass | Handlers declare `features[]` and are filtered by the dispatcher before execution. |

### 14.3 Backward Compatibility

| Concern | Mitigation |
|---------|------------|
| Existing notifications break | No changes to existing notification types, renderers, or actions. Handlers are purely additive. |
| Existing polling still works | The 5-second poll is unchanged. Handlers are an additional consumer of poll results. |
| Modules without handlers | Work exactly as before. No opt-in required. |

### 14.4 Open Questions

1. **Should handlers be able to suppress the notification from appearing in the panel?** (e.g., "I handled this via a popup, don't show it in the inbox too") — Decision: No for v1. Handlers and panel display are independent concerns. A handler can call `ctx.dismiss()` if it wants to remove the notification from the inbox after handling.

2. **Should handler execution be logged to the audit log?** — Decision: No for v1. Handler execution is a client-side side-effect, not a server-side action. DevTools logging is sufficient.

3. **Should there be a "debounce" option for handlers?** (e.g., "only fire once per 10 seconds for this type") — Decision: Yes, add optional `debounceMs` field to `NotificationHandler` in v1. Useful for high-frequency notification types.

---

## 15. Integration Test Coverage

| # | Test Case | Covers |
|---|-----------|--------|
| 1 | Register a handler for `sales.order.created`, create an order, verify toast appears within poll interval | Basic handler dispatch |
| 2 | Register two handlers for same type, verify both execute | Multi-handler dispatch |
| 3 | Register handler with `features: ['admin.only']`, verify it doesn't fire for non-admin user | ACL filtering |
| 4 | Create same notification twice (poll overlap), verify handler fires exactly once | Idempotency |
| 5 | Register handler with wildcard `sales.*`, create `sales.order.created` and `sales.quote.created`, verify both trigger | Wildcard matching |
| 6 | Handler calls `ctx.popup()`, verify dialog renders | Popup effect |
| 7 | Handler calls `ctx.emitEvent()`, verify component subscribed via `addEventListener` receives it | DOM event bridge |
| 8 | Handler calls `ctx.dismiss()`, verify notification removed from panel | Auto-dismiss |
| 9 | `useNotificationEffect` in a component, verify effect runs on matching notification | Hook API |
| 10 | `useNotificationEffect` component unmounts, verify no effect on next notification | Hook cleanup |
| 11 | Handler throws error, verify other handlers still execute and poll continues | Error isolation |
| 12 | Record locks module: replace polling loop with handlers, verify contention banner still updates | Migration validation |
| 13 | Handler with `debounceMs: 5000`, two notifications within 3s, verify handler fires once | Debounce |

---

## 16. Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-02-24 | Piotr Karwatka | Initial draft |
