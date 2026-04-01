# Integration Commands & Events API (SPEC-045j)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-29 |
| **Builds on** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub), 2026-03-29-integration-projects |
| **Related** | SPEC-041 (UMES), SPEC-057 (Webhooks), 2026-03-29-google-workspace-integration, ANALYSIS-007 (Akeneo), 2026-03-23-inbound-webhook-handlers |

## TLDR

**Key Points:**
- Extend the Integration Marketplace so every integration can declare **typed commands** (≈ Zapier actions) and **typed events** (≈ Zapier triggers) that are discoverable, callable, and subscribable by any other module — without knowing implementation details.
- A module like `forms` can call `gateway.execute('google_sheets', 'read-sheet', { sheetName: 'Products' })` and receive native-format results. An `isReady()` check lets callers verify the integration is enabled and configured before use.

**Scope:**
- New `IntegrationCommandDefinition` and `IntegrationEventDefinition` types added to existing `IntegrationDefinition` in `integration.ts`
- `IntegrationGateway` DI service — unified entry point for executing commands, checking readiness, listing capabilities
- Auto-discovered `commands/*.ts` files in integration packages (one handler per command, metadata + default export — like workers/subscribers)
- Inbound webhook → event bridge for external triggers (row added in Sheets, record updated in Akeneo)
- SSE bridge integration with session-scoped events (`sessionId` + `integrationId` + `projectId`) for real-time progress per integration run
- Settings UI: every integration lists its supported commands and events in the detail page
- Programmatic capability discovery API (`GET /api/integrations/:id/capabilities`)
- Project-aware command execution (builds on integration-projects spec)

**Provider examples reworked in this spec:**
- **Google Sheets**: Bundle with 2 children — `sync_google_sheets` (Connector: commands `read-sheet`, `write-row`, `list-spreadsheets`; events `row.added`, `row.updated`, `row.deleted`) and `sync_google_sheets_products` (Product Import: DataSyncAdapter, requires catalog). See [2026-03-29-google-workspace-integration](./2026-03-29-google-workspace-integration.md) for full spec.
- **Akeneo PIM**: commands (`get-product`, `list-products`, `get-family`, `get-category`, `list-families`), events per data sync, automatic graceful degradation when catalog module absent

**Concerns:**
- Must be 100% backward compatible — additive-only changes to `IntegrationDefinition`
- External webhook events require the integration to own its inbound webhook endpoint
- Commands return **native external format** (not normalized) — callers accept the source system's data shape

---

## Overview

### Market Reference: Zapier

Zapier's integration model (https://zapier.com/apps/google-sheets/integrations) centers on **Triggers** (events that start workflows) and **Actions** (operations that do things). Each "app" publishes a catalog of triggers and actions with defined input/output schemas. Users compose workflows by connecting triggers to actions across apps.

**What we adopt:**
- Static trigger/action catalog per integration with typed input/output schemas (zod)
- `isReady()` concept — Zapier checks "is this app connected?" before offering triggers/actions
- Event-driven trigger delivery via webhooks
- Programmatic capability listing for cross-module discovery
- Category-tagged commands (`read`, `write`, `action`) for UI grouping

**What we adapt:**
- Zapier triggers → Open Mercato **integration events** emitted into the existing event bus with `clientBroadcast: true`
- Zapier actions → Open Mercato **integration commands** executed via `IntegrationGateway` DI service
- Zapier workflow composition → delegated to Open Mercato's `workflows` module and direct programmatic calls

**What we reject:**
- Zapier's workflow engine (Open Mercato has its own)
- Zapier's OAuth abstraction (we use our own Credentials API)
- Dynamic schema discovery at runtime (we prefer static code declarations for predictability and offline availability)
- Zapier's polling triggers (we use webhook-based or internal event emission only)

### Also studied: n8n and Make (Integromat)

- **n8n**: Node-based, each node has `execute()` method with typed parameters. Adopted: the single execute entry-point pattern. Rejected: n8n's node graph UI (we have workflows module).
- **Make**: Module-based, each module exposes "actions" and "triggers" with typed configuration. Adopted: the module-scoped capability concept. Rejected: Make's proprietary config DSL.

---

## Problem Statement

Today's integrations are **opaque data-sync pipelines** — they import/export data but don't expose their capabilities as callable services. Five gaps exist:

1. **No Command API** — A module like `forms` cannot call "read row 5 from Sheet1 via Google Sheets." Integrations only support full data sync, not individual operations.

2. **No capability discovery** — There is no way to ask "what can the Akeneo integration do?" at runtime. Other modules cannot list available operations or check if specific commands exist.

3. **No readiness check** — No simple `isReady()` function exists to verify an integration is enabled, configured, and has valid credentials before attempting to use it. Callers must piece together state + credentials checks manually.

4. **No external event ingestion standard** — No standard pattern for integrations to surface external system events (e.g., "row added in Google Sheets" via webhook) into the platform event bus. Each integration would need to build its own event emission plumbing.

5. **No session-scoped progress events** — Data sync events (`data_sync.run.started`, etc.) exist but lack session/run context for browser-side correlation. When two Akeneo syncs run concurrently (different projects), the UI cannot distinguish which events belong to which run.

6. **No mode flexibility** — Integrations like Google Sheets are hardcoded as product importers. If a tenant wants to use Google Sheets only for reading/writing data from forms — without product sync — they cannot.

---

## Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|-----------|-----------|
| 1 | Command output format | **Native external format** | Commands return the external system's raw data. Normalized data is what `data_sync` is for. Callers accept the source format. Optional `outputSchema` (zod) provides type documentation. |
| 2 | Where to declare commands/events | **Extend existing `integration.ts`** | New optional `commands` and `integrationEvents` arrays on `IntegrationDefinition`. Avoids a new convention file. Handlers live in separate `commands/*.ts` files. |
| 3 | Command handler file structure | **Separate files in `commands/` directory** | One file per command, auto-discovered with metadata export (like workers/subscribers). Follows existing convention patterns. |
| 4 | Google Sheets mode flexibility | **Structural separation via bundle children** | The connector (`sync_google_sheets`) and product importer (`sync_google_sheets_products`) are separate child integrations. This avoids runtime mode toggles and keeps commands available without catalog sync. |
| 5 | Catalog module dependency (Akeneo) | **Automatic runtime check** | `isModuleEnabled('catalog')` at boot. If catalog absent, DataSyncAdapter not registered but commands still work (they talk to external API directly). |
| 6 | Event naming convention | **`<integrationId>.<entity>.<action>`** | Integration-scoped events follow the same `module.entity.action` convention. E.g., `sync_akeneo.product.fetched`, `sync_google_sheets.row.added`. |
| 7 | Session scoping | **`sessionId` in event payload** | UUID generated per operation (command batch or sync run). All events in that operation carry the same `sessionId` + `integrationId` + `projectId`. Browser filters by session. |
| 8 | Gateway service location | **DI service in `integrations` module** | `integrationGateway` registered in `integrations/di.ts`. Available to any module via `ctx.resolve('integrationGateway')`. |
| 9 | Project awareness | **Optional `project` slug in all gateway methods** | Defaults to `'default'`. Builds on integration-projects spec. All credential/state resolution flows through project. |

---

## Proposed Solution

### 1. Extend `IntegrationDefinition` with Commands & Events

Additive-only — new optional fields on the existing type in `packages/shared/src/modules/integrations/types.ts`:

```typescript
// New types
interface IntegrationCommandDefinition {
  id: string                         // e.g., 'get-product' (unique within integration)
  label: string                      // 'Get Product'
  description?: string               // Human-readable description
  category?: 'read' | 'write' | 'action'  // For UI grouping
  inputSchema: z.ZodType             // Zod schema for input validation
  outputSchema?: z.ZodType           // Optional zod schema for output documentation
  requiredModules?: string[]         // Module IDs that must be enabled (e.g., ['catalog'])
}

interface IntegrationEventDefinition {
  id: string                         // Fully qualified: 'sync_akeneo.record.imported'
  label: string                      // 'Record Imported'
  description?: string
  category?: 'webhook' | 'sync' | 'lifecycle'
  payloadSchema?: z.ZodType          // Optional schema for payload documentation
  source?: 'webhook' | 'internal'   // Where this event originates
  clientBroadcast?: boolean          // Default: true for integration events
}

// Extended IntegrationDefinition (additive — all new fields optional)
interface IntegrationDefinition {
  // ... all existing fields unchanged ...

  /** Commands this integration exposes (Zapier "actions") */
  commands?: IntegrationCommandDefinition[]

  /** Events this integration can emit (Zapier "triggers") */
  integrationEvents?: IntegrationEventDefinition[]
}
```

### 2. Command Handler Convention (`commands/*.ts`)

Auto-discovered files following the workers/subscribers pattern:

```typescript
// packages/sync-akeneo/src/modules/sync_akeneo/commands/get-product.ts

import { z } from 'zod'
import type { IntegrationCommandContext } from '@open-mercato/shared/modules/integrations/types'

export const metadata = {
  commandId: 'get-product',
  id: 'sync_akeneo:get-product',
}

export default async function handle(
  input: z.infer<typeof inputSchema>,
  ctx: IntegrationCommandContext
): Promise<unknown> {
  const client = createAkeneoClient(ctx.credentials)
  return client.getProduct(input.identifier)
}

const inputSchema = z.object({
  identifier: z.string().min(1),
})
```

**`IntegrationCommandContext`** provides:
```typescript
interface IntegrationCommandContext {
  credentials: Record<string, unknown>   // Decrypted credentials
  integrationId: string
  projectId: string
  projectSlug: string
  sessionId: string                      // Unique per execution
  scope: IntegrationScope                // { organizationId, tenantId }
  resolve: <T = unknown>(name: string) => T  // DI resolver
  emit: (eventId: string, payload: Record<string, unknown>) => Promise<void>  // Emit integration events
  log: IntegrationLogWriter              // Integration log writer
}
```

### 3. IntegrationGateway DI Service

Central entry point registered in the `integrations` module:

```typescript
interface IntegrationGateway {
  /** Execute an integration command. Returns native external format. */
  execute<TOutput = unknown>(
    integrationId: string,
    commandId: string,
    input: unknown,
    options?: GatewayOptions
  ): Promise<TOutput>

  /** Check if integration is enabled + configured + has valid credentials */
  isReady(
    integrationId: string,
    options?: GatewayOptions
  ): Promise<boolean>

  /** Get full capability catalog (commands + events + readiness + projects) */
  getCapabilities(
    integrationId: string,
    options?: GatewayOptions
  ): Promise<IntegrationCapabilities>

  /** List commands declared by integration (static, from definition) */
  listCommands(integrationId: string): IntegrationCommandDefinition[]

  /** List events declared by integration (static, from definition) */
  listEvents(integrationId: string): IntegrationEventDefinition[]

  /** List projects for an integration (delegates to project service) */
  listProjects(
    integrationId: string,
    scope: IntegrationScope
  ): Promise<IntegrationProjectSummary[]>
}

interface GatewayOptions {
  project?: string        // Project slug, defaults to 'default'
  sessionId?: string      // Caller-provided sessionId for event correlation; auto-generated if omitted
  idempotencyKey?: string // Caller-provided idempotency key for write/action commands
  scope?: IntegrationScope // Caller scope; usually resolved from auth context
}

interface IntegrationCapabilities {
  integrationId: string
  title: string
  commands: IntegrationCommandDefinition[]
  events: IntegrationEventDefinition[]
  isReady: boolean
  projects: IntegrationProjectSummary[]
}

interface IntegrationProjectSummary {
  id: string
  name: string
  slug: string
  isDefault: boolean
  isReady: boolean
}
```

### 4. Inbound Webhook → Event Bridge

Integrations that receive webhooks from external systems follow the existing `WebhookEndpointAdapter` pattern (SPEC-057 / `2026-03-23-inbound-webhook-handlers`):

1. Integration registers a `WebhookEndpointAdapter` via `registerWebhookEndpointAdapter()`
2. External system sends webhook to `POST /api/webhooks/inbound/:endpointId`
3. Adapter's `verifyWebhook()` validates the signature
4. Adapter's `processInbound()` parses the payload and emits an integration event:

```typescript
// Inside processInbound():
await emitIntegrationEvent('sync_google_sheets.row.added', {
  integrationId: 'sync_google_sheets',
  projectId,
  sessionId: generateSessionId(),
  spreadsheetId: payload.spreadsheetId,
  sheetName: payload.sheetName,
  rowIndex: payload.rowIndex,
  values: payload.values,
})
```

The emitted event flows through the standard event bus → SSE bridge → browser.

### 5. Session-Scoped Events

Every integration event payload includes three correlation fields:

```typescript
interface IntegrationEventPayload {
  integrationId: string    // Which integration emitted this
  projectId: string        // Which project configuration
  sessionId: string        // UUID unique to this operation run
  // ... event-specific fields
  tenantId: string         // Required for SSE routing
  organizationId?: string
}
```

**Browser-side filtering:**
```typescript
useAppEvent('sync_akeneo.*', (event) => {
  if (event.payload.sessionId === currentSessionId) {
    // This event belongs to our current operation
    updateProgressUI(event)
  }
})
```

**Session ID lifecycle:**
- For gateway `execute()` calls: auto-generated per call (or caller provides one for batch correlation)
- For data sync runs: matches the `SyncRun.id` (existing runs already have unique IDs)
- For inbound webhooks: generated per webhook receipt

### 6. Rollout Dependency & Default-Project Fallback

This spec **builds on** [2026-03-29-integration-projects](./2026-03-29-integration-projects.md). Multi-project command execution, per-project readiness, and per-project webhook correlation MUST NOT ship before the project model exists in core services.

Until that spec lands, Phase 1 may ship in **default-project compatibility mode** only:

- `IntegrationGateway.execute()` and `isReady()` may accept `options.project`, but core resolution collapses to `'default'`
- `listProjects()` returns a synthetic single-item list: `{ slug: 'default', isDefault: true }`
- capability APIs may expose the `project` parameter, but providers MUST treat omitted or unknown project values as `'default'`
- webhook-originated integration events MUST still include `projectSlug: 'default'`; `projectId` may remain unset until the projects spec is implemented

Once integration-projects lands:

- credentials/state/health resolution becomes project-aware in core services
- gateway project selection becomes authoritative
- webhook adapters MUST resolve project identity before emitting integration events
- API examples in this spec become the real multi-project contract rather than compatibility shims

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Consumer Module (e.g., forms, workflows, custom)                          │
│                                                                             │
│  const gw = ctx.resolve('integrationGateway')                              │
│  if (await gw.isReady('sync_akeneo')) {                                    │
│    const product = await gw.execute('sync_akeneo', 'get-product', input)   │
│  }                                                                         │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  IntegrationGateway (packages/core/src/modules/integrations/lib/gateway.ts)│
│                                                                             │
│  1. Resolve IntegrationDefinition from registry                            │
│  2. Validate commandId exists in definition.commands                       │
│  3. Validate input against command.inputSchema (zod)                       │
│  4. Resolve project (default or specified)                                 │
│  5. Resolve + decrypt credentials via CredentialsService                   │
│  6. Check integration state (enabled?)                                     │
│  7. Build IntegrationCommandContext                                        │
│  8. Delegate to command handler (resolved from DI registry)                │
│  9. Log execution to IntegrationLog                                        │
│  10. Return native result                                                  │
└──────┬─────────────────────────────┬────────────────────────────────────────┘
       │                             │
       ▼                             ▼
┌──────────────────────┐  ┌───────────────────────────────────────────────────┐
│ Command Handler      │  │ Integration Services (existing)                   │
│ Registry             │  │                                                   │
│                      │  │ • CredentialsService — decrypt per project        │
│ Map<integrationId,   │  │ • StateService — check enabled per project        │
│   Map<commandId,     │  │ • LogService — write execution logs               │
│     handler>>        │  │ • ProjectService — resolve project by slug        │
│                      │  │ • HealthService — health checks                   │
│ Populated at boot    │  │                                                   │
│ from auto-discovered │  │ All project-aware (integration-projects spec)     │
│ commands/*.ts files  │  │                                                   │
└──────────────────────┘  └───────────────────────────────────────────────────┘
```

### Event Flow (Integration Events → SSE)

```
External System (e.g., Google Sheets webhook)
       │
       ▼
POST /api/webhooks/inbound/:endpointId
       │
       ▼
WebhookEndpointAdapter.processInbound()
       │
       ├── Emits: sync_google_sheets.row.added
       │   payload: { integrationId, projectId, sessionId, sheetName, rowIndex, values }
       │
       ▼
Event Bus (packages/events)
       │
       ├── Persistent subscribers (e.g., workflow triggers, notification handlers)
       │
       ├── Cross-process bridge (PostgreSQL LISTEN/NOTIFY) — if clientBroadcast: true
       │
       └── SSE stream → browser
              │
              ▼
       useAppEvent('sync_google_sheets.row.*', handler)
       → filters by sessionId for scoped progress
```

### Internal Events (Sync Progress)

```
DataSyncEngine.runImport()
       │
       ├── Emits: sync_akeneo.sync.started  { sessionId: runId, integrationId, projectId }
       │
       ├── Per batch:
       │   Emits: sync_akeneo.record.imported { sessionId, recordId, status, ... }
       │
       └── Emits: sync_akeneo.sync.completed { sessionId, stats, ... }
              │
              ▼
       SSE → browser → useAppEvent('sync_akeneo.*', filterBySession)
```

### Event Registration Contract

Integration events are author-defined in `integration.ts`, but they MUST become first-class declared platform events at runtime so the existing event bus, workflow event picker, and SSE bridge continue to work without special cases.

The registration contract is:

1. Provider authors declare static `integrationEvents` on `IntegrationDefinition`
2. The CLI generator reads those definitions while building module metadata
3. The generator appends **synthetic `EventModuleConfig` entries** to `events.generated.ts`
4. App bootstrap continues to call `registerEventModuleConfigs(eventModuleConfigs)` exactly once
5. `isBroadcastEvent()`, `getDeclaredEvents()`, `/api/events`, and SSE all work through the existing event registry with no alternate path

Important constraints:

- Provider modules MUST NOT create a second copy of the same integration events in `events.ts`
- Integration event IDs remain frozen once published, like any other event ID
- `emitIntegrationEvent()` MUST reject event IDs not present in the integration's declared `integrationEvents`
- Synthetic event configs use the provider module's module id for discoverability, but keep the integration event id exactly as declared

This preserves the current authoring rule from `packages/events/AGENTS.md` in spirit: all emitted events are declared before runtime emission. The declaration source is `integration.ts`, but the effective runtime registration path is still the generated event-config pipeline.

### Module Boundaries

| Component | Package | Rationale |
|-----------|---------|-----------|
| `IntegrationCommandDefinition`, `IntegrationEventDefinition`, `IntegrationCommandContext` types | `@open-mercato/shared` | Cross-package types, no domain dependency |
| `IntegrationGateway` service, command handler registry, gateway API routes | `@open-mercato/core` (integrations module) | Core integration infrastructure |
| Command handler files (`commands/*.ts`) | Provider packages (e.g., `@open-mercato/sync-akeneo`) | Provider-specific implementation |
| Generator for `commands/*.ts` auto-discovery | `@open-mercato/cli` | Build tooling |
| Capabilities UI tab | `@open-mercato/ui` (via UMES widget injection) | UI layer |

### Graceful Degradation Without Target Modules

Integration commands talk to **external APIs directly** — they do not depend on local platform modules. This means commands work even when the integration's primary target module (e.g., `catalog` for Akeneo) is not installed.

The degradation pattern is:

1. **At boot** — provider `di.ts` checks `isModuleEnabled('catalog')` (or other target module)
2. **If present** — registers both command handlers AND `DataSyncAdapter` (full functionality)
3. **If absent** — registers only command handlers (commands + events work; sync does not)

This is **automatic** — no user setting needed. The `IntegrationGateway` reports accurate capabilities via `getCapabilities()`: commands are always listed, but sync-related features only appear when the target module is available.

Providers that conditionally register adapters MUST declare the dependency in their command definitions via `requiredModules` so the Capabilities tab can show which commands need which modules.

### Generated Bootstrap Wiring

This spec adds generated runtime wiring in two places:

- `commands.generated.ts` — imports auto-discovered command handlers and registers them via `registerIntegrationCommandHandler()`
- `events.generated.ts` — includes synthetic `EventModuleConfig` entries for `integrationEvents`

Bootstrap contract:

- `bootstrap-registrations.generated.ts` imports `commands.generated.ts` for side-effect registration so app bootstrap code does not need a new manual import
- existing bootstrap code keeps calling `registerEventModuleConfigs(eventModuleConfigs)`; integration events participate through the same generated array
- the standalone app template MUST mirror the same generated bootstrap registrations in the same PR to avoid template drift

This avoids adding a bespoke bootstrap path for commands while keeping generated file contracts additive-only.

---

## Data Models

### No New Entities

This spec introduces **no new database entities**. All changes are to TypeScript types and runtime registries:

### New Types in `packages/shared/src/modules/integrations/types.ts`

```typescript
// --- Command Definition ---

export interface IntegrationCommandDefinition {
  /** Command ID, unique within the integration (e.g., 'get-product') */
  id: string
  /** Human-readable label (e.g., 'Get Product') */
  label: string
  /** Description of what the command does */
  description?: string
  /** Category for UI grouping */
  category?: 'read' | 'write' | 'action'
  /** Zod schema for input validation */
  inputSchema: z.ZodType
  /** Optional zod schema documenting the output shape */
  outputSchema?: z.ZodType
  /** Module IDs that must be enabled for this command to work */
  requiredModules?: string[]
}

// --- Event Definition (integration-scoped) ---

export interface IntegrationEventDefinition {
  /** Fully qualified event ID: '<integrationId>.<entity>.<action>' */
  id: string
  /** Human-readable label */
  label: string
  /** Description */
  description?: string
  /** Category for UI grouping */
  category?: 'webhook' | 'sync' | 'lifecycle'
  /** Optional zod schema documenting the payload shape */
  payloadSchema?: z.ZodType
  /** Where this event originates */
  source?: 'webhook' | 'internal'
  /** Whether to broadcast to browser via SSE (default: true) */
  clientBroadcast?: boolean
  /** Whether to broadcast to portal via SSE */
  portalBroadcast?: boolean
}

// --- Command Handler Context ---

export interface IntegrationCommandContext {
  /** Decrypted credentials for the resolved project */
  credentials: Record<string, unknown>
  /** Integration ID */
  integrationId: string
  /** Resolved project UUID */
  projectId: string
  /** Resolved project slug */
  projectSlug: string
  /** Session ID for event correlation */
  sessionId: string
  /** Optional idempotency key forwarded by the caller for write/action commands */
  idempotencyKey?: string
  /** Tenant scope */
  scope: IntegrationScope
  /** DI container resolver */
  resolve: <T = unknown>(name: string) => T
  /** Emit an integration event (auto-adds integrationId, projectId, sessionId) */
  emit: (eventId: string, payload: Record<string, unknown>) => Promise<void>
  /** Integration log writer */
  log: {
    info: (message: string, payload?: Record<string, unknown>) => Promise<void>
    warn: (message: string, payload?: Record<string, unknown>) => Promise<void>
    error: (message: string, payload?: Record<string, unknown>) => Promise<void>
  }
}

// --- Command Handler Metadata (auto-discovery) ---

export interface IntegrationCommandHandlerMeta {
  /** Command ID matching IntegrationCommandDefinition.id */
  commandId: string
  /** Unique handler ID: '<integrationId>:<commandId>' */
  id: string
}

// --- Gateway Types ---

export interface GatewayOptions {
  /** Project slug, defaults to 'default' */
  project?: string
  /** Session ID for event correlation; auto-generated if omitted */
  sessionId?: string
  /** Caller-provided idempotency key for write/action commands */
  idempotencyKey?: string
  /** Caller scope; resolved from auth context if omitted */
  scope?: IntegrationScope
}

export interface IntegrationCapabilities {
  integrationId: string
  title: string
  commands: IntegrationCommandDefinition[]
  events: IntegrationEventDefinition[]
  isReady: boolean
  projects: IntegrationProjectSummary[]
}

export interface IntegrationProjectSummary {
  id: string
  name: string
  slug: string
  isDefault: boolean
  isReady: boolean
}
```

### Modified Type: `IntegrationDefinition`

| Change | Detail |
|--------|--------|
| **Add field** | `commands?: IntegrationCommandDefinition[]` — optional array of command definitions |
| **Add field** | `integrationEvents?: IntegrationEventDefinition[]` — optional array of event definitions |

Both fields are optional. Existing integrations without commands/events continue to work unchanged.

### New Runtime Registry

In `packages/shared/src/modules/integrations/types.ts`:

```typescript
// Command handler registry (populated from auto-discovered commands/*.ts)
const integrationCommandHandlerRegistry = new Map<string, Map<string, IntegrationCommandHandler>>()

export function registerIntegrationCommandHandler(
  integrationId: string,
  commandId: string,
  handler: IntegrationCommandHandler
): void

export function getIntegrationCommandHandler(
  integrationId: string,
  commandId: string
): IntegrationCommandHandler | undefined

export type IntegrationCommandHandler = (
  input: unknown,
  ctx: IntegrationCommandContext
) => Promise<unknown>
```

---

## API Contracts

### New: Capabilities API

#### `GET /api/integrations/:id/capabilities`

Returns the full capability catalog for an integration.

**Query params:**
- `project` (optional, string) — project slug for readiness check. Default: `'default'`

**Readiness semantics:**

- `ready = true` means: integration exists, is enabled for the resolved project, required credentials are present, and all `requiredModules` for the declared command/event set are enabled
- `ready = false` does **not** imply the last health check failed; health is reported separately
- `isReady()` is a fast, local preflight and MUST NOT perform provider network I/O
- explicit provider connectivity checks remain the job of the existing health-check route/service

**Response (200):**
```json
{
  "integrationId": "sync_akeneo",
  "title": "Akeneo PIM",
  "isReady": true,
  "commands": [
    {
      "id": "get-product",
      "label": "Get Product",
      "description": "Fetch a single product from Akeneo by identifier",
      "category": "read",
      "inputSchema": { "type": "object", "properties": { "identifier": { "type": "string" } }, "required": ["identifier"] },
      "outputSchema": { "type": "object", "description": "Akeneo product (native format)" }
    },
    {
      "id": "list-products",
      "label": "List Products",
      "description": "List products from Akeneo with optional filters",
      "category": "read",
      "inputSchema": { "type": "object", "properties": { "limit": { "type": "number" }, "updatedAfter": { "type": "string" } } }
    }
  ],
  "events": [
    {
      "id": "sync_akeneo.sync.started",
      "label": "Sync Started",
      "category": "sync",
      "source": "internal"
    },
    {
      "id": "sync_akeneo.record.imported",
      "label": "Record Imported",
      "category": "sync",
      "source": "internal"
    }
  ],
  "projects": [
    { "id": "uuid-1", "name": "Default", "slug": "default", "isDefault": true, "isReady": true },
    { "id": "uuid-2", "name": "EU Production", "slug": "eu_production", "isDefault": false, "isReady": true }
  ]
}
```

**ACL:** `integrations.view`

**OpenAPI:** Exported.

#### `GET /api/integrations/:id/commands`

List commands only (lightweight).

**Response (200):**
```json
{
  "items": [
    { "id": "get-product", "label": "Get Product", "category": "read", "description": "..." },
    { "id": "list-products", "label": "List Products", "category": "read", "description": "..." }
  ]
}
```

**ACL:** `integrations.view`

#### `GET /api/integrations/:id/events`

List events only (lightweight).

**Response (200):**
```json
{
  "items": [
    { "id": "sync_akeneo.sync.started", "label": "Sync Started", "category": "sync", "source": "internal" },
    { "id": "sync_akeneo.record.imported", "label": "Record Imported", "category": "sync", "source": "internal" }
  ]
}
```

**ACL:** `integrations.view`

### New: Command Execution API

#### `POST /api/integrations/:id/commands/:commandId/execute`

Execute an integration command.

**Query params:**
- `project` (optional, string) — project slug. Default: `'default'`

**Request body:**
```json
{
  "input": {
    "identifier": "SKU-12345"
  },
  "sessionId": "optional-caller-session-id",
  "idempotencyKey": "optional-for-write-and-action-commands"
}
```

**Response (200):**
```json
{
  "result": { /* native format from external system */ },
  "sessionId": "uuid-of-session",
  "executionMs": 342
}
```

**Error responses:**
- `400` — Invalid input (zod validation failed), command not found
- `404` — Integration not found
- `409` — Integration not ready (disabled or credentials missing)
- `500` — Command execution failed (external API error)

**Execution semantics:**

- `read` commands may be retried by callers
- `write` and `action` commands MUST be treated as non-retriable by default unless the caller supplies an `idempotencyKey`
- the gateway MUST pass `idempotencyKey` into `IntegrationCommandContext` unchanged
- provider handlers for `write`/`action` commands MUST either:
  - forward the key to the external provider when supported, or
  - document best-effort semantics and avoid automatic retries
- the gateway MUST NOT persist raw credential values, auth tokens, or full native write payloads in logs
- success logs should capture command id, execution time, project, and compact metadata only; large/native results stay in the HTTP response, not the audit log

**ACL:** `integrations.manage`

**OpenAPI:** Exported.

### New: Readiness Check API

#### `GET /api/integrations/:id/ready`

Quick readiness check.

**Query params:**
- `project` (optional, string) — project slug. Default: `'default'`

**Response (200):**
```json
{
  "ready": true,
  "integrationId": "sync_akeneo",
  "project": "default",
  "enabled": true,
  "credentialsConfigured": true,
  "commands": 5,
  "events": 4
}
```

**ACL:** `integrations.view`

### Modified: Existing List API

#### `GET /api/integrations`

**Additive change:** Each integration in the response gains optional `commandCount` and `eventCount` fields:

```json
{
  "items": [
    {
      "id": "sync_akeneo",
      "title": "Akeneo PIM",
      "commandCount": 5,
      "eventCount": 4,
      "... existing fields ..."
    }
  ]
}
```

**Backward compatible:** New fields are additive.

---

## Events & SSE

### New Integration Events (Registered at Module Boot)

Integration events declared in `integrationEvents` are registered in the global event registry during module initialization. The generator aggregates all integration definitions and produces a registration call.

**Event ID convention:** `<integrationId>.<entity>.<action>` — follows existing `module.entity.action` pattern.

**All integration events** include the standard correlation payload:

```typescript
interface IntegrationEventBasePayload {
  integrationId: string
  projectId: string
  projectSlug: string
  sessionId: string
  tenantId: string
  organizationId?: string | null
}
```

**Broadcast payload budget:**

- events with `clientBroadcast: true` MUST stay below the SSE bridge payload limit with margin; target payload size is **<= 2 KB**
- payloads intended for browser progress UI MUST contain summaries, counters, identifiers, and small previews only
- native external documents, large row arrays, binary blobs, or full webhook bodies MUST NOT be broadcast to SSE clients
- when repeated events of the same type may occur inside 500ms, payloads SHOULD include a differentiator such as `batchIndex`, `sequence`, or `rowKey` to avoid client dedup collisions

### Akeneo Events

| Event ID | Category | Source | Broadcast | Payload (additional) |
|----------|----------|--------|-----------|---------------------|
| `sync_akeneo.sync.started` | sync | internal | `clientBroadcast: true` | `{ runId, entityType, direction }` |
| `sync_akeneo.sync.completed` | sync | internal | `clientBroadcast: true` | `{ runId, stats: { created, updated, skipped, failed } }` |
| `sync_akeneo.sync.failed` | sync | internal | `clientBroadcast: true` | `{ runId, error }` |
| `sync_akeneo.record.imported` | sync | internal | `clientBroadcast: true` | `{ runId, externalId, localId?, entityType, action: 'created'\|'updated'\|'skipped' }` |

### Google Sheets Events

| Event ID | Category | Source | Broadcast | Payload (additional) |
|----------|----------|--------|-----------|---------------------|
| `sync_google_sheets.row.added` | webhook | webhook | `clientBroadcast: true` | `{ spreadsheetId, sheetName, rowIndex, values }` |
| `sync_google_sheets.row.updated` | webhook | webhook | `clientBroadcast: true` | `{ spreadsheetId, sheetName, rowIndex, oldValues?, values }` |
| `sync_google_sheets.row.deleted` | webhook | webhook | `clientBroadcast: true` | `{ spreadsheetId, sheetName, rowIndex }` |
| `sync_google_sheets_products.import.started` | sync | internal | `clientBroadcast: true` | `{ runId, spreadsheetId, sheetName }` |
| `sync_google_sheets_products.import.completed` | sync | internal | `clientBroadcast: true` | `{ runId, stats }` |

### Webhook Project Correlation & Google Event Derivation

Inbound webhook routing remains provider-owned. The current webhooks hub resolves adapters by `endpointId`, then hands provider code `{ eventType, payload, tenantId?, organizationId? }`.

Project-aware integrations therefore MUST supply their own correlation strategy:

- the provider owns how `endpointId` maps to project/account context
- `verifyWebhook()` or `processInbound()` MUST resolve the target project before calling `emitIntegrationEvent()`
- until integration-projects lands, providers emit webhook events with `projectSlug: 'default'`

For Google Sheets specifically, row-level events are **derived events**, not native webhook facts:

- Google's push notification indicates that a spreadsheet changed; it does not authoritatively classify the change as row-added / row-updated / row-deleted
- the provider MUST fetch the changed sheet range, compare it with provider-owned row-state snapshots, and then emit the derived row event(s)
- row-state storage and hashing remain provider-owned and are specified in the Google Workspace spec
- derivation MUST be idempotent: replaying the same inbound notification must not emit duplicate row mutations after reconciliation
- if the provider cannot safely classify the change, it SHOULD emit no row event and write a warning log rather than guessing

### SSE Bridge Integration

Integration events with `clientBroadcast: true` flow through the existing DOM Event Bridge:

1. Event emitted via `emitIntegrationEvent()` or `ctx.emit()` in command handler
2. Event bus delivers to in-memory subscribers + cross-process bridge
3. SSE endpoint filters by `tenantId` + `organizationId` (existing logic)
4. Browser receives via `EventSource`, dispatches as `om:event` CustomEvent
5. Consumer uses `useAppEvent('sync_akeneo.*', handler)` with session filtering

**No changes to the SSE infrastructure** — integration events use the existing pipeline.

### Session-Based Filtering (Browser)

```typescript
// In a React component managing an integration operation:
const [sessionId] = useState(() => crypto.randomUUID())

// Execute command with session
const result = await apiCall('POST', `/api/integrations/sync_akeneo/commands/list-products/execute`, {
  input: { limit: 100 },
  sessionId,
})

// Listen for correlated events
useAppEvent('sync_akeneo.*', (event) => {
  if (event.payload.sessionId === sessionId) {
    updateProgress(event)
  }
}, [sessionId])
```

---

## UI/UX Design

### Integration Detail Page — Capabilities Tab

New UMES-injected tab on every integration detail page that has commands or events:

```
┌──────────────────────────────────────────────────────────────────┐
│  🔌 Akeneo PIM                                           [Back] │
│                                                                  │
│  Project: [ ▼ Default         ] [+ New]                          │
│                                                                  │
│  ┌────────────┬──────────┬──────────────┬────────┬──────┐        │
│  │Capabilities│Credentials│    Version   │ Health │ Logs │        │
│  └────────────┴──────────┴──────────────┴────────┴──────┘        │
│                                                                  │
│  Commands (5)                                                    │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ 📖 Get Product                              [▶ Try] │        │
│  │    Fetch a single product from Akeneo by identifier  │        │
│  │    Input: { identifier: string }                     │        │
│  │    Category: read                                    │        │
│  ├──────────────────────────────────────────────────────┤        │
│  │ 📖 List Products                            [▶ Try] │        │
│  │    List products with optional filters               │        │
│  │    Input: { limit?: number, updatedAfter?: string }  │        │
│  │    Category: read                                    │        │
│  ├──────────────────────────────────────────────────────┤        │
│  │ 📖 Get Family                               [▶ Try] │        │
│  │ 📖 Get Category                             [▶ Try] │        │
│  │ 📖 List Families                            [▶ Try] │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                  │
│  Events (4)                                                      │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ ⚡ Sync Started         source: internal  cat: sync  │        │
│  │    sync_akeneo.sync.started                          │        │
│  ├──────────────────────────────────────────────────────┤        │
│  │ ⚡ Sync Completed       source: internal  cat: sync  │        │
│  │ ⚡ Sync Failed          source: internal  cat: sync  │        │
│  │ ⚡ Record Imported      source: internal  cat: sync  │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

### "Try It" Dialog

When clicking `[▶ Try]` on a command:

```
┌────────────────────────────────────────────────┐
│  Try: Get Product                              │
│                                                │
│  Project: [ ▼ Default            ]             │
│                                                │
│  Input:                                        │
│  ┌──────────────────────────────────────────┐  │
│  │ {                                        │  │
│  │   "identifier": "SKU-12345"              │  │
│  │ }                                        │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  Result:                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ { "uuid": "...", "family": "shoes",      │  │
│  │   "values": { ... }, ... }               │  │
│  └──────────────────────────────────────────┘  │
│  Execution: 342ms                              │
│                                                │
│                    [Cancel]  [⌘+Enter Execute] │
└────────────────────────────────────────────────┘
```

- JSON editor for input (pre-populated from schema defaults)
- JSON viewer for result
- Cmd+Enter to execute, Escape to cancel

### Marketplace List Enhancement

Integration cards in the marketplace gain capability badges:

```
┌──────────────────────────────────────┐
│ 🔌 Akeneo PIM              Enabled  │
│ Data Sync                            │
│ 5 commands · 4 events               │  ← NEW badges
│ Import Akeneo product catalogs...    │
└──────────────────────────────────────┘
```

### Capabilities Tab Injection Strategy for Bundles

For bundled integrations with multiple children (e.g., Google Workspace), the Capabilities tab is injected **per child integration**, not per bundle. Each child has its own detail page with its own widget spot ID, so:

- **`sync_google_sheets` (Connector)** detail page → Capabilities tab shows 3 commands + 3 events
- **`sync_google_sheets_products` (Product Import)** detail page → Capabilities tab shows 0 commands + 4 events
- **`sync_akeneo`** (standalone) detail page → Capabilities tab shows 5 commands + 4 events

The Capabilities tab widget checks `definition.commands?.length > 0 || definition.integrationEvents?.length > 0` for the **specific child integration** whose detail page it is injected into. If neither is present, the tab is hidden for that child.

This means:
- Provider-owned detail pages (via UMES widget spots) render the Capabilities tab alongside provider tabs — no conflict
- The tab fetches `GET /api/integrations/:childIntegrationId/capabilities` scoped to the child
- Bundle-level detail pages (`/backend/integrations/bundle/:id`) do NOT show a Capabilities tab (bundles don't declare commands/events themselves)

### Google Workspace Presentation

The detail UI reflects the structural split from the Google Workspace spec:

- the connector child shows commands/events and account status
- the product-import child shows sync-specific tabs such as source, mapping, and schedule
- there is no runtime `importMode` selector in this spec

---

## Migration & Backward Compatibility

### Zero-Migration Spec

This spec introduces **no database changes**. All new state is:
- TypeScript types (compile-time)
- In-memory registries (runtime)
- API endpoints (additive)
- UI widgets (injected via UMES)

Project-aware persistence and project entities are defined in [2026-03-29-integration-projects](./2026-03-29-integration-projects.md), not here. This spec may rely on that foundation but does not duplicate its schema changes.

### Backward Compatibility Surface Checklist

| # | BC Surface | Impact | Mitigation |
|---|-----------|--------|------------|
| 1 | Auto-discovery conventions | **ADDITIVE** | New `commands/*.ts` auto-discovery added; all existing conventions unchanged |
| 2 | Type definitions | **ADDITIVE** | 2 new optional fields on `IntegrationDefinition`; no removed/narrowed fields |
| 3 | Function signatures | **ADDITIVE / DEPENDENT** | Existing public APIs remain callable without project arguments; project-aware service growth is owned by the integration-projects spec and must remain optional/default-compatible |
| 4 | Import paths | **ADDITIVE** | New exports from `@open-mercato/shared/modules/integrations/types`; no moved modules |
| 5 | Event IDs | **ADDITIVE** | New integration events; no existing events renamed/removed |
| 6 | Widget injection spot IDs | **ADDITIVE** | New capabilities tab widget; no existing spots changed |
| 7 | API route URLs | **ADDITIVE** | 5 new endpoints; existing list endpoint gains additive fields only |
| 8 | Database schema | **NONE in this spec** | Project-aware schema changes, where needed, come from the integration-projects spec |
| 9 | DI service names | **ADDITIVE** | New `integrationGateway` service; no renames |
| 10 | ACL feature IDs | **NONE** | Reuses existing `integrations.view` and `integrations.manage` |
| 11 | Notification type IDs | **NONE** | No new notification types |
| 12 | CLI commands | **NONE** | Generator updated but no CLI command changes |
| 13 | Generated file contracts | **ADDITIVE** | New `commands.generated.ts`; `events.generated.ts` gains synthetic integration event entries via the existing bootstrap path |

---

## Akeneo Provider Spec Extension

### Commands

| Command ID | Label | Category | Input | Output (native) | Required Modules |
|-----------|-------|----------|-------|-----------------|-----------------|
| `get-product` | Get Product | read | `{ identifier: string }` | `AkeneoProduct` | — |
| `list-products` | List Products | read | `{ limit?: number, updatedAfter?: string, family?: string }` | `{ items: AkeneoProduct[], nextUrl: string \| null, totalEstimate: number \| null }` | — |
| `get-family` | Get Family | read | `{ code: string }` | `AkeneoFamily \| null` | — |
| `list-families` | List Families | read | `{ limit?: number }` | `{ items: AkeneoFamily[], nextUrl: string \| null }` | — |
| `get-category` | Get Category | read | `{ code: string }` | `AkeneoCategory \| null` | — |

### Events

Declared in `integration.ts`, emitted from the sync engine and workers:

| Event ID | Label | Category | Source |
|----------|-------|----------|--------|
| `sync_akeneo.sync.started` | Sync Started | sync | internal |
| `sync_akeneo.sync.completed` | Sync Completed | sync | internal |
| `sync_akeneo.sync.failed` | Sync Failed | sync | internal |
| `sync_akeneo.record.imported` | Record Imported | sync | internal |

### Catalog Module Dependency

In `packages/sync-akeneo/src/modules/sync_akeneo/di.ts`:

```typescript
import { isModuleEnabled } from '@open-mercato/shared/lib/modules/registry'

export function register(container) {
  // Commands always registered — they talk to Akeneo API directly
  registerIntegrationCommandHandler('sync_akeneo', 'get-product', getProductHandler)
  registerIntegrationCommandHandler('sync_akeneo', 'list-products', listProductsHandler)
  registerIntegrationCommandHandler('sync_akeneo', 'get-family', getFamilyHandler)
  registerIntegrationCommandHandler('sync_akeneo', 'list-families', listFamiliesHandler)
  registerIntegrationCommandHandler('sync_akeneo', 'get-category', getCategoryHandler)

  // DataSyncAdapter only registered if catalog module is available
  if (isModuleEnabled('catalog')) {
    registerDataSyncAdapter(akeneoAdapter)
  }
}
```

### Project-Aware Credential Resolution in Command Handlers

Command handlers do **not** resolve credentials themselves. The `IntegrationGateway.execute()` method handles all project/credential resolution before calling the handler. The handler receives a fully populated `IntegrationCommandContext` with decrypted credentials for the resolved project:

```typescript
// commands/get-product.ts — handler receives pre-resolved context
export default async function handle(
  input: { identifier: string },
  ctx: IntegrationCommandContext
): Promise<unknown> {
  // ctx.credentials — already decrypted for the correct project
  // ctx.projectId — UUID of the resolved project
  // ctx.projectSlug — slug (e.g., 'eu_production' or 'default')
  const client = createAkeneoClient(ctx.credentials as AkeneoCredentialShape)
  return client.getProduct(input.identifier)
}
```

The caller specifies the project at the gateway level:
```typescript
// Consumer code in another module
const product = await gateway.execute('sync_akeneo', 'get-product',
  { identifier: 'SKU-123' },
  { project: 'eu_production' }  // resolved by gateway before handler is called
)
```

When `project` is omitted, the gateway defaults to `'default'` — matching the integration-projects spec.

### File Manifest (Akeneo changes)

| File | Action | Purpose |
|------|--------|---------|
| `packages/sync-akeneo/src/modules/sync_akeneo/integration.ts` | Modify | Add `commands` and `integrationEvents` arrays |
| `packages/sync-akeneo/src/modules/sync_akeneo/commands/get-product.ts` | Create | Command handler for get-product |
| `packages/sync-akeneo/src/modules/sync_akeneo/commands/list-products.ts` | Create | Command handler for list-products |
| `packages/sync-akeneo/src/modules/sync_akeneo/commands/get-family.ts` | Create | Command handler for get-family |
| `packages/sync-akeneo/src/modules/sync_akeneo/commands/list-families.ts` | Create | Command handler for list-families |
| `packages/sync-akeneo/src/modules/sync_akeneo/commands/get-category.ts` | Create | Command handler for get-category |
| `packages/sync-akeneo/src/modules/sync_akeneo/lib/client.ts` | Modify | Add `getProduct(identifier)` method |
| `packages/sync-akeneo/src/modules/sync_akeneo/di.ts` | Modify | Register command handlers; conditional DataSyncAdapter |
| `packages/sync-akeneo/src/modules/sync_akeneo/workers/first-import.ts` | Modify | Emit sync lifecycle events |
| `packages/sync-akeneo/src/modules/sync_akeneo/i18n/en.json` | Modify | Add command/event labels |

---

## Google Sheets Provider Spec Extension

> **Full spec:** [2026-03-29-google-workspace-integration](./2026-03-29-google-workspace-integration.md)

The Google Workspace integration is restructured as a **bundle with two child integrations**:

### Bundle: `sync_google_workspace`

Shared OAuth client credentials (`clientId`, `clientSecret`). Per-project Google account connections (one project = one Google account, per integration-projects spec).

### Child 1: `sync_google_sheets` (Connector)

Commands on the **connector** child (always available, no module dependencies):

| Command ID | Label | Category | Input | Output (native) |
|-----------|-------|----------|-------|-----------------|
| `read-sheet` | Read Sheet | read | `{ spreadsheetId, sheetName, range?, limit? }` | `{ headers: string[], rows: string[][], totalRows }` |
| `write-row` | Write Row | write | `{ spreadsheetId, sheetName, values: string[] }` | `{ updatedRange, updatedRows }` |
| `list-spreadsheets` | List Spreadsheets | read | `{ search?, limit? }` | `{ items: { id, name, modifiedTime, sheetCount }[] }` |

Events on the connector (webhook-based):

| Event ID | Label | Category | Source |
|----------|-------|----------|--------|
| `sync_google_sheets.row.added` | Row Added | webhook | webhook |
| `sync_google_sheets.row.updated` | Row Updated | webhook | webhook |
| `sync_google_sheets.row.deleted` | Row Deleted | webhook | webhook |

### Child 2: `sync_google_sheets_products` (Product Import)

Separate child integration for product sync. Requires `catalog` module (automatic `isModuleEnabled('catalog')` check — if absent, this child's DataSyncAdapter is not registered).

Events:

| Event ID | Label | Category | Source |
|----------|-------|----------|--------|
| `sync_google_sheets_products.import.started` | Import Started | sync | internal |
| `sync_google_sheets_products.import.completed` | Import Completed | sync | internal |
| `sync_google_sheets_products.import.failed` | Import Failed | sync | internal |
| `sync_google_sheets_products.record.imported` | Record Imported | sync | internal |

### Key Architectural Change from Archived SPEC-045g

The original spec had a single `sync_google_sheets_products` integration with an `importMode` toggle. The new design replaces the toggle with proper separation:
- **Connector** is default and always available — any module can call `gateway.execute('sync_google_sheets', 'read-sheet', ...)` without product import being configured
- **Product Import** is an opt-in child that admin enables separately when they want catalog sync
- No `importMode` credential field needed — the separation is structural

---

## Implementation Plan

### Phase 1: Core Framework — Types, Gateway, Handler Registry

**Goal:** Introduce the type system, gateway service, command handler auto-discovery, and capability APIs — without provider changes.

#### Step 1.1: Shared Types

- Add `IntegrationCommandDefinition`, `IntegrationEventDefinition`, `IntegrationCommandContext`, `IntegrationCommandHandlerMeta`, `GatewayOptions`, `IntegrationCapabilities`, `IntegrationProjectSummary` to `packages/shared/src/modules/integrations/types.ts`
- Add `commands` and `integrationEvents` optional fields to `IntegrationDefinition`
- Add command handler registry functions: `registerIntegrationCommandHandler()`, `getIntegrationCommandHandler()`, `getIntegrationCommandHandlers()`

**Testable:** Types compile. Registry functions work in unit tests.

#### Step 1.2: Command Handler Auto-Discovery

- Update generator in `packages/cli/` to discover `commands/*.ts` files in integration modules
- Each file must export `metadata: IntegrationCommandHandlerMeta` and a default handler function
- Generator produces `commands.generated.ts` that imports and registers all handlers
- `bootstrap-registrations.generated.ts` imports `commands.generated.ts` so runtime registration happens through the existing bootstrap hook
- Update `yarn generate` to include command discovery

**Testable:** Generator discovers command files and produces valid output.

#### Step 1.3: IntegrationGateway Service

- Create `packages/core/src/modules/integrations/lib/gateway.ts`
- Implement `execute()`: resolve definition → validate commandId → validate input (zod) → resolve project → resolve credentials → build context → delegate to handler → log execution
- Implement `isReady()`: resolve state (enabled?) → resolve credentials (all required fields present?) → verify `requiredModules` availability without provider network I/O
- Implement `listCommands()`, `listEvents()`, `getCapabilities()`, `listProjects()`
- Register as `integrationGateway` in DI (`di.ts`)

**Testable:** Unit tests for gateway with mock handlers. `isReady()` returns correct results.

#### Step 1.4: Capability API Routes

- `GET /api/integrations/:id/capabilities` — full catalog with readiness
- `GET /api/integrations/:id/commands` — commands list
- `GET /api/integrations/:id/events` — events list
- `GET /api/integrations/:id/ready` — quick readiness check
- `POST /api/integrations/:id/commands/:commandId/execute` — command execution
- All routes export `openApi`
- ACL: `integrations.view` for reads, `integrations.manage` for execute

**Testable:** API integration tests for all endpoints.

#### Step 1.5: Integration List Enhancement

- Update `GET /api/integrations` response enricher to add `commandCount` and `eventCount` from definitions
- Additive-only — existing response shape preserved

**Testable:** List response includes counts for integrations with commands.

---

### Phase 2: Event Bridge — Integration Events, Sessions, SSE

**Goal:** Integration events flow through the event bus to SSE with session correlation.

#### Step 2.1: Integration Event Registration

- Integration events declared in `integrationEvents` are registered in the global event registry at module boot
- Generator aggregates all integration definitions' `integrationEvents` into synthetic `EventModuleConfig` entries inside `events.generated.ts`
- Events use `clientBroadcast` / `portalBroadcast` from their definitions

**Testable:** Integration events appear in `getDeclaredEvents()`. `isBroadcastEvent()` returns true for `clientBroadcast: true` events.

#### Step 2.2: Event Emission Helper

- Create `emitIntegrationEvent(eventId, payload, scope)` helper in `packages/core/src/modules/integrations/lib/event-emitter.ts`
- Auto-injects `integrationId`, `projectId`, `sessionId`, `tenantId`, `organizationId` from context
- Validates event ID is declared in the integration's `integrationEvents`
- Wraps the standard event bus `emit()` with `persistent: true` for webhook-sourced events

**Testable:** Emitted events contain all correlation fields. Unknown event IDs are rejected.

#### Step 2.3: Command Context `emit()` Integration

- Wire `IntegrationCommandContext.emit()` to use the `emitIntegrationEvent()` helper
- Auto-populates `integrationId`, `projectId`, `sessionId` from command context
- Command handlers can emit events during execution for progress tracking

**Testable:** Events emitted from command handlers carry correct session context.

#### Step 2.4: Sync Engine Event Emission

- Update data sync workers to emit integration-scoped events when the integration defines them
- `sync.started`, `sync.completed`, `sync.failed` emitted with `sessionId = runId`
- `record.imported` emitted per batch (not per record — for performance) with batch summary

**Testable:** Running an Akeneo sync emits integration events that reach SSE.

---

### Phase 3: Settings UI — Capabilities Tab

**Goal:** Every integration with commands or events shows a Capabilities tab in the admin panel.

#### Step 3.1: Capabilities Tab Widget

- Create UMES widget for the integration detail page
- Injected via `widgets/injection-table.ts` into **both** the `LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID` (platform-rendered pages) and per-integration widget spots (`buildIntegrationDetailWidgetSpotId(id)`) for provider-owned pages
- Only rendered when the specific child integration has `commands.length > 0` or `integrationEvents.length > 0`
- Fetches capabilities from `GET /api/integrations/:id/capabilities` where `:id` is the child integration ID
- For bundle children: each child's detail page gets its own Capabilities tab showing only that child's commands/events
- Bundle-level pages (`/backend/integrations/bundle/:id`) do NOT show the Capabilities tab

**Testable:** Tab appears for integrations with commands. Hidden for integrations without. Works on both platform-rendered and provider-owned detail pages.

#### Step 3.2: Command List & Schema Display

- List commands with: label, description, category badge, input schema (rendered as JSON schema tree)
- `[▶ Try]` button next to each command

**Testable:** Commands render with correct labels and schemas.

#### Step 3.3: "Try It" Dialog

- Modal dialog with JSON editor for input
- Project selector (when multiple projects exist)
- Execute button (`Cmd+Enter`) calls `POST /api/integrations/:id/commands/:commandId/execute`
- Result displayed as formatted JSON with execution time
- `Escape` to cancel

**Testable:** Full execute flow from dialog.

#### Step 3.4: Event List Display

- List events with: label, description, category badge, source badge, event ID
- Payload schema rendered as JSON schema tree (when available)

**Testable:** Events render with correct labels.

#### Step 3.5: Marketplace Badges

- Integration cards show "N commands · M events" badge when available
- Only shown when `commandCount > 0 || eventCount > 0`

**Testable:** Badges appear on marketplace cards.

---

### Phase 4: Akeneo Provider — Commands & Events

**Goal:** Akeneo integration exposes 5 read commands and 4 sync events.

#### Step 4.1: Akeneo Client Extension

- Add `getProduct(identifier: string)` method to `client.ts` (calls `GET /api/rest/v1/products/{identifier}`)
- Existing methods already cover: `listProducts`, `getFamily`, `listFamilies`, `getCategory`

**Testable:** New client method returns product data.

#### Step 4.2: Command Handler Files

- Create 5 command handler files in `commands/`:
  - `get-product.ts`, `list-products.ts`, `get-family.ts`, `list-families.ts`, `get-category.ts`
- Each exports `metadata` and default handler function
- Handlers create Akeneo client from credentials, call the appropriate method, return native result

**Testable:** Each handler returns expected data shape.

#### Step 4.3: Integration Definition Update

- Add `commands` array with 5 `IntegrationCommandDefinition` entries
- Add `integrationEvents` array with 4 `IntegrationEventDefinition` entries
- Both with zod schemas

**Testable:** Capabilities API returns correct catalog for Akeneo.

#### Step 4.4: Sync Event Emission

- Update `workers/first-import.ts` to emit `sync_akeneo.sync.started` at start, `sync_akeneo.sync.completed`/`sync_akeneo.sync.failed` at end
- Emit `sync_akeneo.record.imported` per batch in the catalog importer
- All with `sessionId = runId`

**Testable:** Full import run produces SSE events visible in browser.

#### Step 4.5: Conditional DataSync Registration

- Update `di.ts` to check `isModuleEnabled('catalog')` before registering DataSyncAdapter
- Command handlers always registered regardless

**Testable:** Without catalog module: commands work, sync is unavailable. With catalog: both work.

---

### Phase 5: Google Sheets Provider — Bundle with Connector + Product Import

**Goal:** Google Sheets integration restructured as a bundle with two children. See [2026-03-29-google-workspace-integration](./2026-03-29-google-workspace-integration.md) for full spec.

#### Step 5.1: Bundle + Two Children

- Update `integration.ts` to define bundle (`sync_google_workspace`) + connector child (`sync_google_sheets`) + product import child (`sync_google_sheets_products`)
- Connector child declares 3 commands and 3 webhook events
- Product import child declares 4 sync lifecycle events

**Testable:** Both children appear in marketplace under bundle grouping.

#### Step 5.2: Connector Command Handlers

- `read-sheet.ts` — uses Google Sheets API to read a range
- `write-row.ts` — appends a row to a sheet
- `list-spreadsheets.ts` — lists spreadsheets accessible by the OAuth token

**Testable:** Commands return expected data shapes.

#### Step 5.3: Inbound Webhook Adapter

- Create `WebhookEndpointAdapter` for Google Sheets push notifications
- `processInbound()` maps Google's change notification to derived `sync_google_sheets.row.added`, `row.updated`, `row.deleted` events after project resolution and row-state reconciliation
- Events emitted with `clientBroadcast: true`

**Testable:** Webhook payload correctly maps to integration events.

#### Step 5.4: Conditional Product Import

- `isModuleEnabled('catalog')` check in `di.ts` — only register DataSyncAdapter when catalog present
- Connector commands always registered regardless
- Product import child has its own detail page with source config, mapping, schedule tabs

**Testable:** Without catalog: connector works, product import child not available. With catalog: both work.

---

## Integration Test Coverage

The implementation MUST ship with integration coverage for the following paths.

### API Paths

- `GET /api/integrations`
  verifies additive `commandCount` / `eventCount` fields without breaking existing shape
- `GET /api/integrations/:id/capabilities`
  verifies command/event catalogs, readiness semantics, and project summaries
- `GET /api/integrations/:id/ready`
  verifies `enabled`, `credentialsConfigured`, `ready`, and command/event counts
- `POST /api/integrations/:id/commands/:commandId/execute`
  verifies read command success, validation failure, disabled integration rejection, missing credentials rejection, and optional `idempotencyKey` passthrough
- `POST /api/webhooks/inbound/:endpointId`
  verifies provider webhook verification, deduplication, tenant scoping, and downstream integration event emission

### UI Paths

- Integration detail page shows the Capabilities tab only when commands/events exist
- Capabilities tab renders commands, events, schema summaries, and project selector state
- "Try It" dialog executes a command, shows the result, and supports `Cmd/Ctrl+Enter` submit plus `Escape` cancel
- Marketplace cards render capability badges only when counts are non-zero

### Event / Worker Paths

- Integration events declared in `integration.ts` appear in `/api/events` and `getDeclaredEvents()`
- `clientBroadcast: true` integration events reach the DOM Event Bridge and are filterable by `sessionId`
- sync-originated integration events emitted from workers propagate across the cross-process event bridge
- repeated events in the same session include a differentiator (`batchIndex` or equivalent) and are not collapsed incorrectly by client deduplication

### Provider-Specific Scenarios

- Akeneo command handlers work without `catalog` enabled
- Akeneo sync events emit only when the sync adapter is registered
- Google Sheets webhook processing resolves the correct project/account context
- Google Sheets row events are emitted only after reconciliation can classify the change safely

### Safety Assertions

- write/action command logs do not contain secrets or full native payload dumps
- oversized event payloads are summarized rather than sent raw over SSE
- project-aware calls fall back safely to `'default'` until the integration-projects foundation is enabled in core

---

## Risks & Impact Review

### Data Integrity Failures

#### External API Errors During Command Execution
- **Scenario**: External system (Akeneo, Google) returns error or times out during command execution
- **Severity**: Medium
- **Affected area**: Command execution API, consumer modules
- **Mitigation**: Gateway catches errors, logs compact metadata only, returns structured errors, and avoids auto-retrying `write` / `action` commands. `idempotencyKey` is forwarded when supplied.
- **Residual risk**: Medium — external systems may still apply writes even when the local request times out.

#### Duplicate External Writes
- **Scenario**: Browser retry, proxy retry, or user re-submit executes a `write-row`-style command twice
- **Severity**: High
- **Affected area**: External provider state, auditability
- **Mitigation**: `write` / `action` commands accept an optional `idempotencyKey`; gateway does not auto-retry mutating commands; providers forward the key when supported and document best-effort behavior otherwise.
- **Residual risk**: Medium — some providers do not support idempotent writes natively.

### Cascading Failures & Side Effects

#### Event Storm from Bulk Webhooks
- **Scenario**: External system sends hundreds of webhook events in seconds (e.g., bulk spreadsheet update), causing SSE flood and subscriber overload
- **Severity**: Medium
- **Affected area**: Event bus, SSE connections, persistent subscribers
- **Mitigation**: Inbound webhook rate limiting (existing, per-endpoint). Persistent subscribers process via queue with bounded concurrency. Browser-facing payloads stay compact and summarized. Repeated event payloads include differentiators to avoid accidental dedup collapse.
- **Residual risk**: Medium — providers may still need debounce/coalescing for very noisy sources.

#### Impossible or Wrongly Classified Google Row Events
- **Scenario**: A Google change notification cannot be safely classified as row-added / updated / deleted, or is attributed to the wrong account/project
- **Severity**: High
- **Affected area**: Google Sheets connector, downstream workflows
- **Mitigation**: Provider-owned project correlation and row-state reconciliation are mandatory before row events are emitted. If classification is ambiguous, emit no row event and log a warning.
- **Residual risk**: Medium — eventual consistency windows can still delay or suppress row-level events.

#### Command Handler Accessing Unavailable Module
- **Scenario**: Command handler tries to use a module that's not installed (e.g., Akeneo command tries to resolve a catalog service)
- **Severity**: Low
- **Affected area**: Command execution
- **Mitigation**: Commands talk to the external API directly — they don't depend on local modules. `requiredModules` on command definitions allows gateway to reject calls before execution. `isModuleEnabled()` check in DI registration prevents handler registration when dependencies are missing.
- **Residual risk**: Negligible.

### Tenant & Data Isolation Risks

#### Cross-Tenant Command Execution
- **Scenario**: Command is executed with wrong tenant's credentials
- **Severity**: Critical
- **Affected area**: Credential resolution
- **Mitigation**: Gateway resolves credentials through tenant-scoped core services. Project-aware execution is blocked on the integration-projects foundation; before that rollout, all project selection collapses to `'default'` to avoid accidental cross-project access.
- **Residual risk**: Negligible — same isolation as existing credential reads.

### Migration & Deployment Risks

#### Rollout Ordering With Integration Projects
- **Scenario**: Commands & Events ships before integration-projects service/schema changes, but callers start sending explicit project slugs
- **Severity**: High
- **Affected area**: Readiness, execution, webhook correlation
- **Mitigation**: Ship this spec in default-project compatibility mode first, or ship after integration-projects. Multi-project behavior must stay feature-flagged until core project resolution is live.
- **Residual risk**: Low when rollout order is enforced.

### Operational Risks

#### Generator Must Be Re-Run
- **Scenario**: Developer adds command handler files but forgets to run `yarn generate`, causing commands to not be registered
- **Severity**: Low
- **Affected area**: Development workflow
- **Mitigation**: Document in AGENTS.md. `yarn dev` already watches for file changes and regenerates. CI/CD pipeline runs `yarn generate` before build.
- **Residual risk**: Negligible — same risk as workers/subscribers today.

#### SSE Payload Truncation
- **Scenario**: Provider emits large native payloads with `clientBroadcast: true`; SSE truncates or drops them
- **Severity**: Medium
- **Affected area**: Real-time browser UX
- **Mitigation**: Only summary payloads are broadcast. Large/native responses stay on command HTTP responses or provider logs, not SSE.
- **Residual risk**: Low.

---

## Final Compliance Report — 2026-03-29

### AGENTS.md Files Reviewed

- `AGENTS.md` (root) — task router, conventions, critical rules, backward compatibility contract
- `packages/core/AGENTS.md` — module development, entities, API routes, events, setup, widgets
- `packages/core/src/modules/integrations/AGENTS.md` — integration-specific patterns, UMES, registry
- `packages/core/src/modules/data_sync/AGENTS.md` — data sync entities, adapters, workers
- `packages/shared/AGENTS.md` — shared utilities, types, no domain dependencies
- `packages/ui/AGENTS.md` — UI components, forms, data tables, injection
- `packages/events/AGENTS.md` — event bus, SSE, cross-process bridge
- `packages/webhooks/AGENTS.md` — webhook module, inbound handling
- `packages/cli/AGENTS.md` — generators, auto-discovery
- `BACKWARD_COMPATIBILITY.md` — 13 contract surfaces

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| Root AGENTS | No direct ORM relationships between modules | ✅ PASS | No new entities; gateway uses DI services only |
| Root AGENTS | Always filter by organization_id | ✅ PASS | All credential/state resolution is tenant-scoped |
| Root AGENTS | Validate all inputs with zod | ✅ PASS | Command inputs validated against `inputSchema` (zod) |
| Root AGENTS | API routes MUST export openApi | ✅ PASS | All 5 new endpoints export openApi |
| Root AGENTS | Event IDs: module.entity.action (singular) | ✅ PASS | `sync_akeneo.sync.started`, `sync_akeneo.record.imported`, etc. |
| Root AGENTS | Feature naming: module.action | ✅ PASS | Reuses existing `integrations.view`, `integrations.manage` |
| Root AGENTS | UUID PKs, explicit FKs | ✅ PASS | No new entities |
| Root AGENTS | Use findWithDecryption for encrypted data | ✅ PASS | Credential resolution uses existing CredentialsService |
| Root AGENTS | Every dialog: Cmd+Enter submit, Escape cancel | ✅ PASS | "Try It" dialog follows convention |
| Root AGENTS | Keep pageSize ≤ 100 | ✅ PASS | Command list responses are small (static definitions) |
| BC Contract | Auto-discovery conventions FROZEN | ✅ PASS | `commands/*.ts` is a new convention, not a change to existing ones |
| BC Contract | Type definitions STABLE | ✅ PASS | 2 new optional fields on IntegrationDefinition; no removed/narrowed fields |
| BC Contract | Function signatures STABLE | ✅ PASS | Existing public signatures stay valid; project-aware growth remains optional/default-compatible |
| BC Contract | Import paths STABLE | ✅ PASS | New exports added; no moved modules |
| BC Contract | Event IDs FROZEN | ✅ PASS | New events only; no existing events changed |
| BC Contract | Widget injection spot IDs FROZEN | ✅ PASS | Uses existing tabs spot; no spots renamed/removed |
| BC Contract | API route URLs STABLE | ✅ PASS | 5 new routes; existing list route gains additive fields only |
| BC Contract | Database schema ADDITIVE-ONLY | ✅ PASS | No database changes |
| BC Contract | DI service names STABLE | ✅ PASS | New `integrationGateway` service; no renames |
| BC Contract | ACL feature IDs FROZEN | ✅ PASS | No new features; reuses existing |
| BC Contract | Generated file contracts STABLE | ✅ PASS | `commands.generated.ts` is additive; `events.generated.ts` grows via the existing bootstrap registration path |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | ✅ Pass | Types map directly to API response shapes |
| API contracts match UI/UX section | ✅ Pass | Capabilities tab consumes capabilities API; Try It dialog calls execute API |
| Risks cover all write operations | ✅ Pass | External write commands now include idempotency/retry and log-safety guidance |
| Commands defined for all mutations | ✅ Pass | Execute is the only mutation; uses gateway service (not CRUD pattern — appropriate for proxy commands) |
| Events cover all state changes | ✅ Pass | Integration events declared; sync lifecycle events mapped |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — ready for implementation.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-03-29 | AI | Initial skeleton with Open Questions |
| 2026-03-29 | AI | Full spec: architecture, types, API contracts, events, SSE, UI, 5-phase implementation plan, Akeneo + Google Sheets provider extensions, compliance review |
| 2026-03-29 | AI | Updated Google Sheets section to match new bundle architecture (connector + product import children). Removed `importMode` toggle — replaced by structural separation. Added reference to new google-workspace-integration spec. |
| 2026-03-29 | AI | Filled remaining readiness-review gaps: explicit event registration contract, default-project rollout semantics, webhook project correlation, write-command idempotency rules, SSE payload constraints, generated bootstrap wiring, and integration test coverage. |
