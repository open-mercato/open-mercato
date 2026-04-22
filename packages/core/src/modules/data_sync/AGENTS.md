# Data Sync Module — Agent Guide

The `data_sync` module provides a streaming data synchronization hub for import/export operations with external systems. It uses an adapter pattern where provider modules register `DataSyncAdapter` implementations.

**Spec**: `.ai/specs/SPEC-045b-data-sync-hub.md`

---

## Module Structure

```
packages/core/src/modules/data_sync/
├── index.ts                     # Module metadata
├── di.ts                        # DI registrations
├── acl.ts                       # Features: view, run, configure
├── setup.ts                     # Default role features
├── events.ts                    # 4 run lifecycle events
├── data/
│   ├── entities.ts              # SyncRun, SyncCursor, SyncMapping, SyncSchedule
│   └── validators.ts            # Zod schemas
├── lib/
│   ├── adapter.ts               # DataSyncAdapter interface + batch types
│   ├── adapter-registry.ts      # Register/get adapters by providerKey
│   ├── id-mapping.ts            # External ID ↔ local ID lookup and storage
│   ├── queue.ts                 # Queue helper for enqueuing sync jobs
│   ├── sync-engine.ts           # Orchestrates streaming import/export with progress
│   └── sync-run-service.ts      # CRUD for SyncRun + cursor management
├── api/
│   ├── run.ts                   # POST /api/data_sync/run — start a sync
│   ├── runs.ts                  # GET /api/data_sync/runs — list runs
│   ├── validate.ts              # POST /api/data_sync/validate — validate connection
│   ├── runs/[id]/
│   │   ├── route.ts             # GET — run detail
│   │   ├── cancel.ts            # POST — cancel running sync
│   │   └── retry.ts             # POST — retry failed sync
│   └── mappings/
│       ├── route.ts             # GET/POST — list/create field mappings
│       └── [id]/route.ts        # GET/PUT/DELETE — manage individual mapping
├── workers/
│   ├── sync-import.ts           # Queue handler for import jobs (concurrency: 5)
│   ├── sync-export.ts           # Queue handler for export jobs (concurrency: 5)
│   └── sync-scheduled.ts        # Handles scheduler dispatch → creates run + enqueues
├── backend/
│   └── data-sync/
│       ├── page.tsx             # Sync runs dashboard (DataTable)
│       ├── page.meta.ts
│       └── runs/[id]/
│           ├── page.tsx         # Run detail (progress bar, counters, logs)
│           └── page.meta.ts
└── i18n/
    ├── en.json
    └── pl.json
```

## Key Services (DI)

| Service Name | Purpose |
|---|---|
| `dataSyncRunService` | CRUD for SyncRun, cursor management, overlap detection |
| `dataSyncEngine` | Orchestrates streaming import/export with batch processing, progress, error logging |
| `externalIdMappingService` | Maps local entity IDs ↔ external system IDs |

## Adapter Contract

Provider modules implement `DataSyncAdapter`:

```typescript
interface DataSyncAdapter {
  providerKey: string
  direction: 'import' | 'export' | 'bidirectional'
  supportedEntities: string[]
  streamImport(entityType: string, cursor: string | null, config: SyncConfig): AsyncIterable<ImportBatch>
  streamExport?(entityType: string, cursor: string | null, config: SyncConfig): AsyncIterable<ExportBatch>
  getInitialCursor?(entityType: string): Promise<string | null>
  getMapping?(entityType: string): Promise<FieldMapping[]>
  validateConnection?(credentials: Record<string, unknown>): Promise<{ valid: boolean; message?: string }>
}
```

Register adapters in your provider module's `di.ts`:
```typescript
registerDataSyncAdapter(myAdapter)
```

If the sync provider needs bootstrap credentials, mappings, locales, channels, or other default sync settings after a fresh install, implement a provider-owned env preset flow:

- read env vars in the provider package
- apply them from the provider module's `setup.ts`
- expose a provider CLI command to rerun the preset outside tenant creation
- persist through normal credentials/mapping/state services instead of special-casing the provider in `data_sync`

## Run Lifecycle

`pending` → `running` → `completed` | `failed` | `cancelled`

- **Cursor persistence**: After each batch, cursor is saved to `SyncCursor`
- **Resume**: Retry reads the last successful cursor, resumes from there
- **Progress**: Linked to `ProgressJob` via `progressJobId` for `ProgressTopBar` display
- **Cancellation**: Via `progressService.isCancellationRequested()`

## Queue Names

| Queue | Worker | Concurrency |
|---|---|---|
| `data-sync-import` | `sync-import.ts` | 5 |
| `data-sync-export` | `sync-export.ts` | 5 |
| `data-sync-scheduled` | `sync-scheduled.ts` | 3 |

## Events

| Event ID | Emitted When |
|---|---|
| `data_sync.run.started` | Sync run begins processing |
| `data_sync.run.completed` | Sync run finishes successfully |
| `data_sync.run.failed` | Sync run fails |
| `data_sync.run.cancelled` | Sync run is cancelled |

## ACL Features

- `data_sync.view` — view sync runs and progress
- `data_sync.run` — trigger, cancel, retry syncs
- `data_sync.configure` — manage field mappings and schedules

## UMES Extensibility

Data sync providers can leverage the **Unified Module Extension System (UMES)** to extend platform UI and behavior.

### Available Extension Points for Sync Providers

| Extension Mechanism | Use Case | Files |
|---|---|---|
| **Widget Injection** | Inject sync status badges, mapping previews, or progress indicators into entity pages | `widgets/injection/`, `widgets/injection-table.ts` |
| **Event Subscribers** | React to sync lifecycle events (`data_sync.run.completed`, etc.) for side-effects | `subscribers/*.ts` |
| **Entity Extensions** | Link sync metadata to core entities | `data/extensions.ts` |
| **Response Enrichers** | Attach sync status or external ID data to other modules' API responses | `data/enrichers.ts` |
| **Notifications** | Emit in-app notifications on sync completion/failure | `notifications.ts`, `subscribers/` |
| **DOM Event Bridge** | Push real-time sync progress to browser (SSE) | Set `clientBroadcast: true` in event definitions |
| **Menu Injection** | Add sidebar items for provider-specific sync dashboards | via `useInjectedMenuItems` |

### Progress Delivery Contract

- `ProgressTopBar` and sync-run detail pages use `progress.job.*` SSE updates for live progress.
- Create `ProgressJob` in `run`/`retry` endpoints; start/update/complete/fail in `sync-engine`.
- Include `progressJob` details in run detail response.
- SSE DOM bridge forwards only events with `clientBroadcast: true`.
- `progress.job.*` events are marked `clientBroadcast: true` and must reach the browser from both web and worker processes.
- Do not add new frontend polling loops for sync progress; use one-shot fetches only for initial hydration or reconnect recovery.

### Integration Test Expectations

- Module-local integration tests go under `__integration__/`
- Use helpers from `@open-mercato/core/modules/core/__integration__/helpers/*`
- Tests must create prerequisites via API and clean up in `finally`
- Avoid hard dependency on late-phase modules; keep tests scoped to implemented contracts

## MUST Rules

- **Always scope by organizationId + tenantId** — every entity query
- **Never import from provider adapter modules** — data_sync is generic
- **Use the queue system** — never run syncs inline in API handlers
- **New sync providers MUST support provider-owned env preconfiguration** when fresh installs need credentials or default mappings/locales/channels from deployment env
- **Persist cursor after each batch** — enables resume on failure
- **Log item-level errors** — don't stop the sync for individual item failures
- **Check for overlap** before starting a new run (same integration + entityType + direction)
- **API routes must export `openApi`** for documentation generation
