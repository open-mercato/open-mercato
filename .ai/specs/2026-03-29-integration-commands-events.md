# Integration Commands & Events API (SPEC-045j)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-29 |
| **Builds on** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub), 2026-03-29-integration-projects |
| **Related** | SPEC-041 (UMES), SPEC-057 (Webhooks), SPEC-045g (Google Workspace), ANALYSIS-007 (Akeneo), 2026-03-23-inbound-webhook-handlers |

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
- **Google Sheets/Worksheets**: commands (`read-sheet`, `write-row`, `list-spreadsheets`), events (`row.added`, `row.updated`), credential-level mode toggle (import products vs API-only), `catalog` dependency like Akeneo
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
| 4 | Worksheets API-only mode | **DataSyncAdapter always registered; sync UI gated by setting** | Setting stored in credentials (`importMode: 'sync' | 'api_only'`). Adapter registered regardless — avoids dynamic registration complexity. |
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

### 6. Provider Mode Setting (Worksheets)

Integration credentials gain an `importMode` field for integrations that support dual modes:

```typescript
// In integration.ts credentials schema
{
  key: 'importMode',
  label: 'Integration Mode',
  type: 'select',
  options: [
    { value: 'sync', label: 'Full Sync — Import products from spreadsheets' },
    { value: 'api_only', label: 'API Only — Expose read/write commands without product sync' },
  ],
  required: true,
  helpText: 'Choose whether to sync products or only expose spreadsheet commands.',
}
```

When `importMode === 'api_only'`:
- DataSyncAdapter is registered (for potential future use) but sync UI and scheduled syncs are hidden
- Commands remain fully functional
- Events from webhooks still fire

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

### Module Boundaries

| Component | Package | Rationale |
|-----------|---------|-----------|
| `IntegrationCommandDefinition`, `IntegrationEventDefinition`, `IntegrationCommandContext` types | `@open-mercato/shared` | Cross-package types, no domain dependency |
| `IntegrationGateway` service, command handler registry, gateway API routes | `@open-mercato/core` (integrations module) | Core integration infrastructure |
| Command handler files (`commands/*.ts`) | Provider packages (e.g., `@open-mercato/sync-akeneo`) | Provider-specific implementation |
| Generator for `commands/*.ts` auto-discovery | `@open-mercato/cli` | Build tooling |
| Capabilities UI tab | `@open-mercato/ui` (via UMES widget injection) | UI layer |

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
  "sessionId": "optional-caller-session-id"
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
| `sync_google_sheets.import.started` | sync | internal | `clientBroadcast: true` | `{ runId, spreadsheetId, sheetName }` |
| `sync_google_sheets.import.completed` | sync | internal | `clientBroadcast: true` | `{ runId, stats }` |

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

### Worksheets Mode Toggle

In the Google Sheets integration credentials tab:

```
┌──────────────────────────────────────────────────────┐
│  Integration Mode                                    │
│  [ ▼ Full Sync — Import products from spreadsheets ] │
│     ○ Full Sync — Import products from spreadsheets  │
│     ○ API Only — Expose read/write commands without  │
│       product sync                                   │
│                                                      │
│  When "API Only" is selected, the Data Sync tab is   │
│  hidden and scheduled syncs are paused.              │
└──────────────────────────────────────────────────────┘
```

---

## Migration & Backward Compatibility

### Zero-Migration Spec

This spec introduces **no database changes**. All new state is:
- TypeScript types (compile-time)
- In-memory registries (runtime)
- API endpoints (additive)
- UI widgets (injected via UMES)

### Backward Compatibility Surface Checklist

| # | BC Surface | Impact | Mitigation |
|---|-----------|--------|------------|
| 1 | Auto-discovery conventions | **ADDITIVE** | New `commands/*.ts` auto-discovery added; all existing conventions unchanged |
| 2 | Type definitions | **ADDITIVE** | 2 new optional fields on `IntegrationDefinition`; no removed/narrowed fields |
| 3 | Function signatures | **NONE** | No existing functions modified |
| 4 | Import paths | **ADDITIVE** | New exports from `@open-mercato/shared/modules/integrations/types`; no moved modules |
| 5 | Event IDs | **ADDITIVE** | New integration events; no existing events renamed/removed |
| 6 | Widget injection spot IDs | **ADDITIVE** | New capabilities tab widget; no existing spots changed |
| 7 | API route URLs | **ADDITIVE** | 5 new endpoints; existing list endpoint gains additive fields only |
| 8 | Database schema | **NONE** | No database changes |
| 9 | DI service names | **ADDITIVE** | New `integrationGateway` service; no renames |
| 10 | ACL feature IDs | **NONE** | Reuses existing `integrations.view` and `integrations.manage` |
| 11 | Notification type IDs | **NONE** | No new notification types |
| 12 | CLI commands | **NONE** | Generator updated but no CLI command changes |
| 13 | Generated file contracts | **ADDITIVE** | New `commands.generated.ts` file; existing generated files unchanged |

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

### Commands

| Command ID | Label | Category | Input | Output (native) | Required Modules |
|-----------|-------|----------|-------|-----------------|-----------------|
| `read-sheet` | Read Sheet | read | `{ spreadsheetId: string, sheetName: string, range?: string }` | `{ headers: string[], rows: string[][] }` | — |
| `write-row` | Write Row | write | `{ spreadsheetId: string, sheetName: string, values: string[] }` | `{ updatedRange: string, updatedRows: number }` | — |
| `list-spreadsheets` | List Spreadsheets | read | `{ limit?: number }` | `{ items: { id: string, name: string }[] }` | — |

### Events

| Event ID | Label | Category | Source |
|----------|-------|----------|--------|
| `sync_google_sheets.row.added` | Row Added | webhook | webhook |
| `sync_google_sheets.row.updated` | Row Updated | webhook | webhook |
| `sync_google_sheets.row.deleted` | Row Deleted | webhook | webhook |
| `sync_google_sheets.import.started` | Import Started | sync | internal |
| `sync_google_sheets.import.completed` | Import Completed | sync | internal |

### Mode Toggle

New credential field in `integration.ts`:

```typescript
{
  key: 'importMode',
  label: 'Integration Mode',
  type: 'select' as const,
  options: [
    { value: 'sync', label: 'Full Sync — Import products from spreadsheets' },
    { value: 'api_only', label: 'API Only — Expose read/write commands without product sync' },
  ],
  required: true,
  helpText: 'Choose whether to sync products or only expose spreadsheet commands for other modules.',
}
```

### Catalog Module Dependency

Same pattern as Akeneo — `catalog` listed in module `requires`, DataSyncAdapter registration conditional on `isModuleEnabled('catalog')` AND `importMode !== 'api_only'`.

### Inbound Webhook for Events

Google Sheets events (`row.added`, `row.updated`, `row.deleted`) come from Google's push notification API:

1. Integration registers a `WebhookEndpointAdapter` for Google Sheets push notifications
2. `processInbound()` maps Google's change notification to typed integration events
3. Events emitted with `clientBroadcast: true` into the event bus

### File Manifest (Google Sheets changes)

| File | Action | Purpose |
|------|--------|---------|
| `packages/sync-google-workspace/src/modules/sync_google_sheets/integration.ts` | Create/Modify | Add `commands`, `integrationEvents`, `importMode` credential field |
| `packages/sync-google-workspace/src/modules/sync_google_sheets/commands/read-sheet.ts` | Create | Read sheet data |
| `packages/sync-google-workspace/src/modules/sync_google_sheets/commands/write-row.ts` | Create | Write row to sheet |
| `packages/sync-google-workspace/src/modules/sync_google_sheets/commands/list-spreadsheets.ts` | Create | List accessible spreadsheets |
| `packages/sync-google-workspace/src/modules/sync_google_sheets/lib/webhook-adapter.ts` | Create | Inbound webhook handler for Google push notifications |
| `packages/sync-google-workspace/src/modules/sync_google_sheets/di.ts` | Create/Modify | Register command handlers, conditional adapter |

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
- Update `yarn generate` to include command discovery

**Testable:** Generator discovers command files and produces valid output.

#### Step 1.3: IntegrationGateway Service

- Create `packages/core/src/modules/integrations/lib/gateway.ts`
- Implement `execute()`: resolve definition → validate commandId → validate input (zod) → resolve project → resolve credentials → build context → delegate to handler → log execution
- Implement `isReady()`: resolve state (enabled?) → resolve credentials (all required fields present?)
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
- Generator aggregates all integration definitions' `integrationEvents` and produces registration calls
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
- Injected via `widgets/injection-table.ts` into the `LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID`
- Only rendered when integration has `commands.length > 0` or `integrationEvents.length > 0`
- Fetches capabilities from `GET /api/integrations/:id/capabilities`

**Testable:** Tab appears for integrations with commands. Hidden for integrations without.

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

### Phase 5: Google Sheets Provider — Commands, Events, Mode Toggle

**Goal:** Google Sheets integration exposes 3 commands, 5 events, and a mode toggle. (Note: this builds on SPEC-045g which may not yet be implemented.)

#### Step 5.1: Command Handler Files

- `read-sheet.ts` — uses Google Sheets API to read a range
- `write-row.ts` — appends a row to a sheet
- `list-spreadsheets.ts` — lists spreadsheets accessible by the OAuth token

**Testable:** Commands return expected data shapes.

#### Step 5.2: Integration Definition Update

- Add `commands`, `integrationEvents` arrays
- Add `importMode` credential field (select: sync / api_only)
- Add `catalog` to module `requires` array

**Testable:** Capabilities API returns correct catalog.

#### Step 5.3: Inbound Webhook Adapter

- Create `WebhookEndpointAdapter` for Google Sheets push notifications
- `processInbound()` maps Google's change notification to `sync_google_sheets.row.added`, `row.updated`, `row.deleted`
- Events emitted with `clientBroadcast: true`

**Testable:** Webhook payload correctly maps to integration events.

#### Step 5.4: Mode Toggle Behavior

- When `importMode === 'api_only'`: hide data sync schedule tab, pause scheduled syncs
- DataSyncAdapter always registered but sync UI conditionally hidden
- Commands always available regardless of mode

**Testable:** API-only mode hides sync UI; commands still work.

---

## Risks & Impact Review

### Data Integrity Failures

#### External API Errors During Command Execution
- **Scenario**: External system (Akeneo, Google) returns error or times out during command execution
- **Severity**: Medium
- **Affected area**: Command execution API, consumer modules
- **Mitigation**: Gateway catches errors, logs to IntegrationLog, returns 500 with structured error. Consumer modules should handle errors gracefully. No local state mutations during command execution (read-through only for initial commands).
- **Residual risk**: Low — commands are stateless read operations initially.

### Cascading Failures & Side Effects

#### Event Storm from Bulk Webhooks
- **Scenario**: External system sends hundreds of webhook events in seconds (e.g., bulk spreadsheet update), causing SSE flood and subscriber overload
- **Severity**: Medium
- **Affected area**: Event bus, SSE connections, persistent subscribers
- **Mitigation**: Inbound webhook rate limiting (existing, per-endpoint). Persistent subscribers process via queue with bounded concurrency. SSE deduplication (existing 500ms window). Integration events with `source: 'webhook'` are always persistent (queued, not immediate).
- **Residual risk**: Low — existing rate limiting and queuing handle this.

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
- **Mitigation**: Gateway resolves credentials through `CredentialsService` which is tenant-scoped. Credentials are keyed by `(integrationId, projectId, organizationId, tenantId)`. The gateway's `execute()` requires `scope` (derived from auth context) — no cross-tenant credential access is possible.
- **Residual risk**: Negligible — same isolation as existing credential reads.

### Migration & Deployment Risks

#### No Database Migration
- **Scenario**: N/A — this spec has no database changes
- **Severity**: N/A
- **Mitigation**: N/A
- **Residual risk**: None.

### Operational Risks

#### Generator Must Be Re-Run
- **Scenario**: Developer adds command handler files but forgets to run `yarn generate`, causing commands to not be registered
- **Severity**: Low
- **Affected area**: Development workflow
- **Mitigation**: Document in AGENTS.md. `yarn dev` already watches for file changes and regenerates. CI/CD pipeline runs `yarn generate` before build.
- **Residual risk**: Negligible — same risk as workers/subscribers today.

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
| BC Contract | Function signatures STABLE | ✅ PASS | No existing function signatures modified |
| BC Contract | Import paths STABLE | ✅ PASS | New exports added; no moved modules |
| BC Contract | Event IDs FROZEN | ✅ PASS | New events only; no existing events changed |
| BC Contract | Widget injection spot IDs FROZEN | ✅ PASS | Uses existing tabs spot; no spots renamed/removed |
| BC Contract | API route URLs STABLE | ✅ PASS | 5 new routes; existing list route gains additive fields only |
| BC Contract | Database schema ADDITIVE-ONLY | ✅ PASS | No database changes |
| BC Contract | DI service names STABLE | ✅ PASS | New `integrationGateway` service; no renames |
| BC Contract | ACL feature IDs FROZEN | ✅ PASS | No new features; reuses existing |
| BC Contract | Generated file contracts STABLE | ✅ PASS | New `commands.generated.ts`; existing files unchanged |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | ✅ Pass | Types map directly to API response shapes |
| API contracts match UI/UX section | ✅ Pass | Capabilities tab consumes capabilities API; Try It dialog calls execute API |
| Risks cover all write operations | ✅ Pass | Command execution (external writes) covered; mode toggle covered |
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
