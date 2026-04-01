# Google Workspace Integration — Connector + Product Import Bundle

**Parent**: [SPEC-045 — Integration Marketplace](./implemented/SPEC-045-2026-02-24-integration-marketplace.md)
**Related**: [SPEC-045a — Foundation](./implemented/SPEC-045a-foundation.md), [SPEC-045b — Data Sync Hub](./implemented/SPEC-045b-data-sync-hub.md), [Integration Commands & Events](./2026-03-29-integration-commands-events.md), [Integration Projects](./2026-03-29-integration-projects.md)
**Supersedes**: [SPEC-045g (archived)](./archived/SPEC-045g-google-workspace.md) — the original single-integration spec. This rewrite separates the generic connector from the product importer and aligns with the integration-projects and integration-commands-events specs.

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-03-29 |
| **Supersedes** | SPEC-045g (archived) |
| **Builds on** | SPEC-045, SPEC-045a, SPEC-045b, 2026-03-29-integration-commands-events, 2026-03-29-integration-projects |
| **Category** | `data_sync` |
| **Package** | `@open-mercato/sync-google-workspace` |

---

## TLDR

**Key Points:**
- Restructure the Google Workspace integration as a **bundle with two child integrations**:
  1. **Google Sheets Connector** (`sync_google_sheets`) — API-only by default. Exposes typed commands (`read-sheet`, `write-row`, `list-spreadsheets`) and webhook-based events (`row.added`, `row.updated`, `row.deleted`). Any module can use these commands without knowing Google APIs.
  2. **Google Sheets Products Import** (`sync_google_sheets_products`) — Optional child that adds product sync via `DataSyncAdapter`. Depends on `catalog` module. Uses the same bundle credentials and Google account.
- **Integration-projects compatible.** Per-project credentials mean each project can hold its own OAuth tokens — naturally supporting multi-account scenarios. No project management logic added by this spec; it relies entirely on the integration-projects spec.
- **API-first design.** The connector child is always available when Google Workspace is enabled. The product importer is a separate opt-in that requires the catalog module.

**Scope:**
- Google Workspace bundle with shared OAuth client credentials
- Google Sheets Connector child with 3 commands and 3 events (via Commands & Events API)
- Google Sheets Products Import child with `DataSyncAdapter`, source config, mapping, scheduled sync
- Per-project OAuth tokens (one project = one Google account)
- Provider-owned OAuth flow, source config, row-state delta tracking
- Reuse of `data_sync` for runs, progress, schedules, mappings

**Out of scope:**
- Google Drive storage provider, Google Docs generation
- Generic core OAuth renderer
- Real-time Google change detection (polling-based webhook in V2)
- Write-back beyond `write-row` command

---

## Overview

### Market Reference: Zapier Google Sheets Integration

Zapier's Google Sheets integration (https://zapier.com/apps/google-sheets/integrations) exposes:
- **Triggers**: New Spreadsheet Row, New or Updated Spreadsheet Row, New Spreadsheet
- **Actions**: Create Spreadsheet Row, Update Spreadsheet Row, Create Spreadsheet, Lookup Spreadsheet Row

**What we adopt:**
- Separation between generic spreadsheet operations (connector) and specific use cases (product import)
- Typed triggers/actions with input/output schemas
- Multiple account support (our integration projects)

**What we reject:**
- Zapier's polling-based triggers (V1 uses webhook push; V2 may add polling)
- Zapier's workflow-only usage (our connector is callable by any module directly)

### Why Bundle Architecture

The original SPEC-045g treated Google Sheets as a single product-import integration. This caused:
1. Tenants who want spreadsheet access for forms/workflows must also configure product sync
2. No way to use Google Sheets commands without enabling the catalog module
3. Monolithic integration that mixes generic spreadsheet access with domain-specific import logic

The bundle architecture solves this:

```
Bundle: sync_google_workspace
├── Shared: OAuth client credentials (clientId, clientSecret)
├── Shared: Per-project Google account connections (OAuth tokens)
│
├── Child: sync_google_sheets (Connector)
│   ├── Commands: read-sheet, write-row, list-spreadsheets
│   ├── Events: row.added, row.updated, row.deleted
│   └── No module dependencies — always available
│
└── Child: sync_google_sheets_products (Product Import)
    ├── DataSyncAdapter for products
    ├── Source config, mapping, scheduling
    └── Requires: catalog module
```

---

## Problem Statement

Same core problem as the archived SPEC-045g (merchants manage products in Google Sheets and need automated import), plus three additional gaps:

1. **No generic spreadsheet access** — Other modules (forms, workflows, custom code) cannot read/write Google Sheets data. The integration is locked to product import only.

2. **Single-purpose integration** — Enabling Google Sheets forces the product import setup flow, even if the tenant only wants spreadsheet commands for a workflow automation.

3. **One account per tenant** — The original spec stores one OAuth token set per bundle. Multi-account (e.g., different Google accounts for different departments or regions) requires the integration-projects model.

---

## Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|-----------|-----------|
| 1 | Integration structure | **Bundle with 2 children** | Connector (generic) and product import (domain-specific) are separate concerns |
| 2 | Default mode | **Connector is default and always available** | Product import is opt-in via separate child integration |
| 3 | OAuth token storage | **Per-project credentials** (via integration-projects spec) | Each project naturally holds its own OAuth tokens — no extra logic needed |
| 4 | Commands location | **Connector child, not bundle** | Commands are specific to Google Sheets, not the entire Google Workspace |
| 6 | Product importer dependency | **Automatic catalog check** | `isModuleEnabled('catalog')` at boot; if absent, only connector registers |
| 7 | Provider-owned OAuth | **Same as archived spec** | Core does not yet render OAuth fields generically |
| 8 | Row-state delta tracking | **Provider-owned entity** | Google Sheets-specific hash logic doesn't belong in generic data_sync |

---

## Architecture

### Package Placement

```text
packages/sync-google-workspace/
└── src/modules/sync_google_workspace/
    ├── index.ts                    # Module metadata, requires: ['integrations', 'data_sync']
    ├── integration.ts              # Bundle + 2 child integrations with commands/events
    ├── di.ts                       # DI wiring: conditional adapter, command handlers
    ├── setup.ts                    # Tenant init, env preset
    ├── cli.ts                      # configure-from-env CLI
    ├── data/
    │   ├── entities.ts             # GoogleSheetsSource, GoogleSheetsRowState
    │   └── validators.ts           # Zod schemas
    ├── lib/
    │   ├── google-client.ts        # Google API client (Sheets + Drive)
    │   ├── oauth-session.ts        # PKCE session cache
    │   ├── oauth.ts                # Token exchange, refresh
    │   ├── health.ts               # Health check
    │   ├── preset.ts               # Env preset
    │   ├── adapter.ts              # DataSyncAdapter (product import)
    │   ├── importer.ts             # Catalog write orchestration
    │   ├── source-service.ts       # Source config CRUD
    │   ├── row-state-service.ts    # Delta hash tracking
    │   └── preview.ts              # Import preview
    ├── commands/                    # Integration commands (auto-discovered)
    │   ├── read-sheet.ts           # Read sheet data
    │   ├── write-row.ts            # Write/append row
    │   └── list-spreadsheets.ts    # List accessible spreadsheets
    ├── api/
    │   ├── account/route.ts        # OAuth account state
    │   ├── oauth/start/route.ts    # Start OAuth flow
    │   ├── oauth/callback/route.ts # OAuth callback
    │   ├── oauth/disconnect/route.ts
    │   ├── source/route.ts         # Source config CRUD
    │   ├── preview/route.ts        # Import preview
    │   └── spreadsheets/
    │       ├── route.ts            # List spreadsheets
    │       └── [spreadsheetId]/route.ts  # Spreadsheet detail
    ├── widgets/
    │   ├── injection-table.ts
    │   └── injection/
    │       ├── setup-guide/        # Setup Guide tab
    │       ├── google-account/     # Google Account tab
    │       └── spreadsheet-source/ # Spreadsheet Source tab (product import only)
    └── i18n/
        ├── en.json
        └── pl.json
```

### Integration Definition

```typescript
import { z } from 'zod'
import { buildIntegrationDetailWidgetSpotId } from '@open-mercato/shared/modules/integrations/types'
import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

// Widget spots
export const googleSheetsConnectorSpotId = buildIntegrationDetailWidgetSpotId('sync_google_sheets')
export const googleSheetsProductsSpotId = buildIntegrationDetailWidgetSpotId('sync_google_sheets_products')

// --- Bundle ---
export const bundle: IntegrationBundle = {
  id: 'sync_google_workspace',
  title: 'Google Workspace',
  description: 'Connect Google accounts to access Sheets, Drive, and future Google services.',
  icon: 'google-workspace',
  package: '@open-mercato/sync-google-workspace',
  version: '1.0.0',
  author: 'Open Mercato Team',
  credentials: {
    fields: [
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', required: true,
        helpText: 'From your Google Cloud Console OAuth 2.0 credentials.' },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'secret', required: true },
    ],
  },
  healthCheck: { service: 'googleWorkspaceHealthCheck' },
}

// --- Child 1: Google Sheets Connector (API-only) ---
const connectorIntegration: IntegrationDefinition = {
  id: 'sync_google_sheets',
  title: 'Google Sheets — Connector',
  description: 'Read and write Google Sheets data. Exposes typed commands for other modules.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: 'google_sheets',
  bundleId: 'sync_google_workspace',
  package: '@open-mercato/sync-google-workspace',
  version: '1.0.0',
  tags: ['google', 'sheets', 'connector', 'api'],
  detailPage: { widgetSpotId: googleSheetsConnectorSpotId },

  // Commands (SPEC-045j: Integration Commands & Events API)
  commands: [
    {
      id: 'read-sheet',
      label: 'Read Sheet',
      description: 'Read rows from a Google Sheets tab. Returns headers and row data in native format.',
      category: 'read',
      inputSchema: z.object({
        spreadsheetId: z.string().min(1),
        sheetName: z.string().min(1),
        range: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
      outputSchema: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        totalRows: z.number(),
      }),
    },
    {
      id: 'write-row',
      label: 'Write Row',
      description: 'Append a row to a Google Sheets tab.',
      category: 'write',
      inputSchema: z.object({
        spreadsheetId: z.string().min(1),
        sheetName: z.string().min(1),
        values: z.array(z.string()),
      }),
      outputSchema: z.object({
        updatedRange: z.string(),
        updatedRows: z.number(),
      }),
    },
    {
      id: 'list-spreadsheets',
      label: 'List Spreadsheets',
      description: 'List Google Sheets accessible by the connected account.',
      category: 'read',
      inputSchema: z.object({
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: z.object({
        items: z.array(z.object({
          id: z.string(),
          name: z.string(),
          modifiedTime: z.string(),
          owner: z.string().optional(),
          sheetCount: z.number(),
        })),
      }),
    },
  ],

  // Events (SPEC-045j)
  integrationEvents: [
    {
      id: 'sync_google_sheets.row.added',
      label: 'Row Added',
      description: 'A new row was added to a watched spreadsheet.',
      category: 'webhook',
      source: 'webhook',
      clientBroadcast: true,
    },
    {
      id: 'sync_google_sheets.row.updated',
      label: 'Row Updated',
      description: 'An existing row was modified in a watched spreadsheet.',
      category: 'webhook',
      source: 'webhook',
      clientBroadcast: true,
    },
    {
      id: 'sync_google_sheets.row.deleted',
      label: 'Row Deleted',
      description: 'A row was removed from a watched spreadsheet.',
      category: 'webhook',
      source: 'webhook',
      clientBroadcast: true,
    },
  ],
}

// --- Child 2: Google Sheets Products Import ---
const productImportIntegration: IntegrationDefinition = {
  id: 'sync_google_sheets_products',
  title: 'Google Sheets — Product Import',
  description: 'Import products from Google Sheets with preview, mapping, and scheduled sync.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: 'google_workspace_products',
  bundleId: 'sync_google_workspace',
  package: '@open-mercato/sync-google-workspace',
  version: '1.0.0',
  tags: ['google', 'sheets', 'products', 'import', 'sync'],
  detailPage: { widgetSpotId: googleSheetsProductsSpotId },

  integrationEvents: [
    {
      id: 'sync_google_sheets_products.import.started',
      label: 'Product Import Started',
      category: 'sync',
      source: 'internal',
      clientBroadcast: true,
    },
    {
      id: 'sync_google_sheets_products.import.completed',
      label: 'Product Import Completed',
      category: 'sync',
      source: 'internal',
      clientBroadcast: true,
    },
    {
      id: 'sync_google_sheets_products.import.failed',
      label: 'Product Import Failed',
      category: 'sync',
      source: 'internal',
      clientBroadcast: true,
    },
    {
      id: 'sync_google_sheets_products.record.imported',
      label: 'Product Record Imported',
      category: 'sync',
      source: 'internal',
      clientBroadcast: true,
    },
  ],
}

export const integrations: IntegrationDefinition[] = [connectorIntegration, productImportIntegration]
```

### Integration Projects Compatibility

This spec does not add any project management logic. It relies entirely on the [integration-projects spec](./2026-03-29-integration-projects.md) for multi-configuration support. Since projects are bundle-scoped, all children in the Google Workspace bundle share the same project list and per-project credentials — which naturally holds OAuth tokens per connected account.

### DI Registration (Conditional)

```typescript
import { isModuleEnabled } from '@open-mercato/shared/lib/modules/registry'

export function register(container) {
  // Connector commands — always registered
  registerIntegrationCommandHandler('sync_google_sheets', 'read-sheet', readSheetHandler)
  registerIntegrationCommandHandler('sync_google_sheets', 'write-row', writeRowHandler)
  registerIntegrationCommandHandler('sync_google_sheets', 'list-spreadsheets', listSpreadsheetsHandler)

  // Product import — only when catalog module is present
  if (isModuleEnabled('catalog')) {
    registerDataSyncAdapter(googleSheetsProductsAdapter)
  }

  // Services
  container.register({
    googleWorkspaceHealthCheck: asFunction(createHealthCheckService),
    googleSheetsSourceService: asFunction(createSourceService),
    googleSheetsRowStateService: asFunction(createRowStateService),
  })
}
```

### Module Dependencies

```typescript
// index.ts
export const metadata = {
  id: 'sync_google_workspace',
  title: 'Google Workspace',
  requires: ['integrations', 'data_sync'],
  // Note: 'catalog' is NOT required at module level.
  // Product import child conditionally registers based on isModuleEnabled('catalog').
}
```

---

## Data Models

### GoogleSheetsSource

Provider-owned source configuration. Includes `projectId` for integration-projects compatibility:

```typescript
@Entity({ tableName: 'google_sheets_sources' })
@Index({ properties: ['integrationId', 'projectId', 'organizationId', 'tenantId'], options: { unique: true } })
export class GoogleSheetsSource {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'spreadsheet_id', type: 'text' })
  spreadsheetId!: string

  @Property({ name: 'spreadsheet_name', type: 'text' })
  spreadsheetName!: string

  @Property({ name: 'sheet_name', type: 'text' })
  sheetName!: string

  @Property({ name: 'header_row', type: 'int', default: 1 })
  headerRow: number = 1

  @Property({ name: 'data_start_row', type: 'int', default: 2 })
  dataStartRow: number = 2

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

**Change from archived spec:** Added `projectId` column. Unique index includes `projectId` — each project can have its own source config.

### GoogleSheetsRowState

Provider-owned delta state for row content hashing. Includes `projectId` for integration-projects compatibility:

```typescript
@Entity({ tableName: 'google_sheets_row_states' })
@Index({ properties: ['integrationId', 'projectId', 'externalId', 'organizationId', 'tenantId'], options: { unique: true } })
export class GoogleSheetsRowState {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'integration_id', type: 'text' })
  integrationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ name: 'external_id', type: 'text' })
  externalId!: string

  @Property({ name: 'last_hash', type: 'text' })
  lastHash!: string

  @Property({ name: 'last_row_number', type: 'int', nullable: true })
  lastRowNumber?: number | null

  @Property({ name: 'last_seen_at', type: Date, nullable: true })
  lastSeenAt?: Date | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

### Credential Shape

```typescript
// Bundle credentials (declared in credentials schema):
type GoogleWorkspaceBundleCredentials = {
  clientId?: string
  clientSecret?: string
}

// Additional fields stored in credentials record (not in declared schema):
type GoogleWorkspaceOAuthFields = {
  oauthTokens?: {
    accessToken: string
    refreshToken?: string
    expiresAt?: string
    tokenType: 'Bearer'
    scope?: string
  }
  oauthProfile?: {
    email: string
    name?: string
    picture?: string
  }
}
```

Per the integration-projects spec, credentials are project-scoped. Each project's credential record holds its own `oauthTokens` and `oauthProfile`.

---

## API Contracts

All provider routes from the archived spec remain valid with one key change: all routes now accept `?project=<slug>` to target a specific project. When omitted, defaults to `'default'`.

### Changed from archived spec:

| Endpoint | Change |
|----------|--------|
| `GET /api/sync_google_workspace/account` | Add `?project=<slug>` param |
| `POST /api/sync_google_workspace/oauth/start` | Add `projectSlug` in request body |
| `GET /api/sync_google_workspace/oauth/callback` | State includes `projectSlug` for token storage |
| `POST /api/sync_google_workspace/oauth/disconnect` | Add `projectSlug` in request body |
| `GET /api/sync_google_workspace/spreadsheets` | Add `?project=<slug>` param |
| `GET /api/sync_google_workspace/spreadsheets/:id` | Add `?project=<slug>` param |
| `GET /api/sync_google_workspace/source` | Add `?project=<slug>` param |
| `PUT /api/sync_google_workspace/source` | Add `projectSlug` in request body |
| `POST /api/sync_google_workspace/preview` | Add `projectSlug` in request body |

**Backward compatible:** Omitting `project` defaults to `'default'` project.

### New: Connector-Specific Routes

Commands are executed via the generic gateway API:

```
POST /api/integrations/sync_google_sheets/commands/read-sheet/execute?project=default
POST /api/integrations/sync_google_sheets/commands/write-row/execute?project=default
POST /api/integrations/sync_google_sheets/commands/list-spreadsheets/execute?project=default
```

No additional provider routes needed for commands — the IntegrationGateway handles execution.

---

## UI/UX Design

### Marketplace View

Two cards visible in the marketplace (grouped under Google Workspace bundle):

```
┌──────────────────────────────────────────────────────────────┐
│  Google Workspace                                            │
│  ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│  │ Google Sheets — Connector   │ │ Google Sheets — Product  │ │
│  │ 3 commands · 3 events       │ │ Import                   │ │
│  │ Read/write spreadsheet data │ │ Import products from     │ │
│  │                [Enabled ●]  │ │ Sheets                   │ │
│  │                             │ │               [Disabled] │ │
│  └─────────────────────────────┘ └─────────────────────────┘ │
│  Shared credentials: ✓ Configured                            │
└──────────────────────────────────────────────────────────────┘
```

### Connector Detail Page

```
┌──────────────────────────────────────────────────────────────┐
│  Google Sheets — Connector                          [Back]   │
│                                                              │
│                                                              │
│  ┌────────────┬──────────────┬──────────┬────────┬──────┐    │
│  │Capabilities│Google Account│  Health  │  Logs  │      │    │
│  └────────────┴──────────────┴──────────┴────────┴──────┘    │
│                                                              │
│  (Capabilities tab: lists 3 commands + 3 events)             │
│  (Google Account tab: connect/disconnect per project)        │
└──────────────────────────────────────────────────────────────┘
```

### Product Import Detail Page

```
┌──────────────────────────────────────────────────────────────┐
│  Google Sheets — Product Import                     [Back]   │
│                                                              │
│                                                              │
│  ┌──────────┬──────────────┬────────┬──────────┬──────┬─────┐│
│  │Setup     │Google Account│ Source │ Schedule │Health│ Logs ││
│  └──────────┴──────────────┴────────┴──────────┴──────┴─────┘│
│                                                              │
│  (Same tabs as archived spec, but project-scoped)            │
└──────────────────────────────────────────────────────────────┘
```

Project selector behavior is defined by the integration-projects spec. This spec adds no custom project UI.

---

## Migration & Backward Compatibility

### From Archived Spec

If the archived SPEC-045g was partially implemented:
- The existing `sync_google_sheets_products` integration ID is preserved
- The bundle ID `sync_google_workspace` is preserved
- New `sync_google_sheets` connector integration is additive
- `projectId` columns on provider entities are backfilled by the integration-projects migration (default project)

### BC Surface

| # | Surface | Impact | Notes |
|---|---------|--------|-------|
| 1 | Auto-discovery | ADDITIVE | New `commands/*.ts` convention |
| 2 | Types | ADDITIVE | New `commands`/`integrationEvents` on child definitions |
| 3 | Function signatures | NONE | No existing functions changed |
| 4 | Import paths | ADDITIVE | New exports only |
| 5 | Event IDs | ADDITIVE | 7 new events; no existing events changed |
| 6 | Widget spots | ADDITIVE | New spot for connector; existing product import spot preserved |
| 7 | API routes | COMPATIBLE | Existing routes gain optional `project` param (defaults to `'default'`) |
| 8 | Database schema | ADDITIVE | `projectId` column added to provider entities |
| 9 | DI services | ADDITIVE | New command handler registrations |
| 10 | ACL features | NONE | Reuses existing `integrations.*` and `data_sync.*` |
| 11 | Integration IDs | ADDITIVE | New `sync_google_sheets`; existing `sync_google_sheets_products` preserved |

---

## Implementation Plan

### Phase 1: Bundle + Connector Foundation

1. Update `integration.ts` to define the bundle + 2 children (connector + product import)
2. Create `commands/read-sheet.ts`, `commands/write-row.ts`, `commands/list-spreadsheets.ts`
3. Update `di.ts` for conditional registration and command handler wiring
4. Add `projectId` to `GoogleSheetsSource` and `GoogleSheetsRowState` entities
5. Generate migration with `yarn db:generate`

**Testable:** Connector appears in marketplace. Commands discoverable via capabilities API.

### Phase 2: OAuth Flow

1. Implement OAuth start/callback/disconnect routes (project-aware via integration-projects spec)
2. Store tokens in credentials record via `integrationCredentialsService.saveField()`
3. Implement Google Account tab widget
4. Implement health check service

**Testable:** OAuth connect/disconnect flow works. Health check reflects token state.

### Phase 3: Connector UI & Events

1. Inject Capabilities tab on connector detail page
2. Wire webhook adapter for Google push notifications (row.added, row.updated, row.deleted events)
3. Test command execution via "Try It" dialog

**Testable:** Commands executable from UI. Events emitted on webhook receipt.

### Phase 4: Product Import (existing logic, now project-scoped)

1. Update adapter and importer to use project-scoped credentials
2. Update source service to scope by `projectId`
3. Ensure data sync runs, mappings, and schedules use `projectId`
4. Emit product import lifecycle events (started, completed, failed, record.imported)

**Testable:** Product import works per-project with independent source configs.

### Phase 5: Hardening & Tests

1. Health check per project
2. Integration tests: multi-project, connector commands, product import
3. Unit tests: OAuth session, command handlers, row-state hashing
4. i18n for all new UI strings

---

## Risks & Impact Review

All risks from the archived SPEC-045g remain valid. Additional risks:

#### Bundle Child Confusion
- **Scenario**: Admin doesn't understand why there are two Google Sheets integrations and enables the wrong one
- **Severity**: Medium
- **Affected area**: Marketplace UX
- **Mitigation**: Clear naming ("Connector" vs "Product Import"), descriptions explain the purpose, bundle grouping shows relationship. Connector is enabled by default when bundle is enabled.
- **Residual risk**: Low — UX makes the distinction clear.

#### Project-Scoped OAuth Token Leakage Between Children
- **Scenario**: One child integration accidentally reads another project's tokens
- **Severity**: Critical
- **Affected area**: Security, tenant isolation
- **Mitigation**: All token resolution goes through `CredentialsService` which scopes by `(integrationId, projectId, scope)`. Bundle fallthrough means children share the bundle's project tokens by design (same Google account). This is correct — both children should use the same OAuth tokens for the same project.
- **Residual risk**: None — this is the intended behavior.

---

## Final Compliance Report — 2026-03-29

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/core/src/modules/data_sync/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| Root AGENTS | External integrations in dedicated workspace packages | ✅ PASS | `packages/sync-google-workspace/` |
| Root AGENTS | No direct ORM relationships between modules | ✅ PASS | Uses IDs and catalog commands |
| Root AGENTS | Scope by organization_id + tenant_id | ✅ PASS | All entities and queries scoped |
| Root AGENTS | Zod validation for all inputs | ✅ PASS | Command schemas + route validators |
| Root AGENTS | API routes export openApi | ✅ PASS | All routes |
| Root AGENTS | Event IDs: module.entity.action | ✅ PASS | `sync_google_sheets.row.added`, etc. |
| BC Contract | Integration IDs FROZEN | ✅ PASS | `sync_google_sheets_products` preserved; new `sync_google_sheets` added |
| BC Contract | Event IDs FROZEN | ✅ PASS | All new events; none removed |
| BC Contract | API routes STABLE | ✅ PASS | Existing routes gain optional param; new routes additive |
| BC Contract | Database ADDITIVE-ONLY | ✅ PASS | New column `projectId`; no removes |

### Verdict

**Fully compliant** — ready for implementation.

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-03-29 | AI | New spec superseding archived SPEC-045g. Bundle architecture with connector + product import children. Project-aware OAuth (one project = one Google account). Integration commands & events. |
