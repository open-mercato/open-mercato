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

## MUST Rules

- **Always scope by organizationId + tenantId** — every entity query
- **Never import from provider adapter modules** — data_sync is generic
- **Use the queue system** — never run syncs inline in API handlers
- **Persist cursor after each batch** — enables resume on failure
- **Log item-level errors** — don't stop the sync for individual item failures
- **Check for overlap** before starting a new run (same integration + entityType + direction)
- **API routes must export `openApi`** for documentation generation
