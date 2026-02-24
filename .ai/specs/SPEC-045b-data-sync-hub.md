# SPEC-045b — Data Sync Hub: Import/Export with Delta Streaming

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 2 of 6
**Depends on**: [SPEC-004 — Progress Module](./SPEC-004-2026-01-23-progress-module.md)

---

## Goal

Build the `data_sync` hub module with a `DataSyncAdapter` contract designed for **high-velocity, delta-based, resumable import/export** using streaming, queue-based processing, and real-time progress tracking via the **progress module** (`ProgressService`). Then build the first provider bundle (`sync_medusa`) as a reference implementation.

---

## 1. Problem Statement

Enterprise integrations move large volumes of data — 100K+ products, millions of orders, continuous inventory updates. A naive "fetch all → process → done" approach fails:

| Problem | Consequence |
|---------|-------------|
| Full dataset import on every run | Hours of processing, wasted bandwidth, server strain |
| No resume on failure | 50K items imported, error at 50,001 → start over |
| No progress visibility | Admin stares at spinner for hours, no idea if stuck or working |
| Errors hidden in server logs | Admin cannot see which items failed or why |
| Blocking request/response | API timeout after 30s; large syncs cannot run inline |

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Delta-first** — every sync run starts from the last known cursor, not from zero | Minimizes data transfer and processing time |
| 2 | **Streaming** — data flows through the system in chunks/batches, never loaded fully into memory | Handles datasets larger than available RAM |
| 3 | **Queue-based** — sync runs are background jobs with controlled concurrency | No API timeouts; multiple syncs can run in parallel |
| 4 | **Resumable** — every batch persists its cursor; failures resume from last successful batch | No re-importing 50K items because item 50,001 failed |
| 5 | **Progress observable** — real-time progress via the `progress` module (`ProgressService`) and `ProgressTopBar` UI | Admin sees progress bar, ETA, item counts in the unified top bar — no custom progress UI needed |
| 6 | **Error coherent** — every item-level error is logged via `integrationLog` with entity context | Admin can filter errors, see which products failed, click through to fix |
| 7 | **Idempotent** — re-running a sync with the same cursor produces the same result | Safe to retry, safe to resume |

---

## 3. DataSyncAdapter Contract

```typescript
// data_sync/lib/adapter.ts

interface DataSyncAdapter {
  readonly providerKey: string
  readonly direction: 'import' | 'export' | 'bidirectional'

  /** Entity types this adapter can sync (e.g., 'catalog.product', 'customers.person') */
  readonly supportedEntities: string[]

  /**
   * Stream data from the external source in batches.
   * Returns an async iterable of batches — each batch has items + a cursor for resumability.
   * The hub module drives the iteration and persists cursors between batches.
   */
  streamImport?(input: StreamImportInput): AsyncIterable<ImportBatch>

  /**
   * Stream data from Open Mercato to the external destination in batches.
   * Receives an async iterable of local entities and pushes them out.
   */
  streamExport?(input: StreamExportInput): AsyncIterable<ExportBatch>

  /**
   * Get the current delta cursor for a given entity type.
   * Called before first sync to determine starting point.
   * Returns null for full initial sync.
   */
  getInitialCursor?(input: GetCursorInput): Promise<string | null>

  /**
   * Get field mapping between external schema and Open Mercato entities.
   * Used by the admin UI to configure/review mapping.
   */
  getMapping(input: GetMappingInput): Promise<DataMapping>

  /**
   * Validate that the mapping and credentials are correct.
   * Called before starting a sync run.
   */
  validateConnection?(input: ValidateConnectionInput): Promise<ValidationResult>
}
```

### 3.1 Import Types

```typescript
interface StreamImportInput {
  entityType: string                    // 'catalog.product'
  cursor?: string                       // Resume from this cursor (null = full sync)
  batchSize: number                     // Items per batch (default: 100)
  credentials: Record<string, unknown>  // From IntegrationCredentials
  mapping: DataMapping                  // Field mapping configuration
  scope: TenantScope
}

interface ImportBatch {
  items: ImportItem[]
  cursor: string         // Cursor to resume from if interrupted after this batch
  hasMore: boolean       // More batches available?
  totalEstimate?: number // Estimated total items (for progress bar)
  batchIndex: number     // Sequential batch number
}

interface ImportItem {
  externalId: string                    // ID in the external system
  data: Record<string, unknown>         // Raw external data
  action: 'create' | 'update' | 'skip' // Determined by adapter (delta logic)
  hash?: string                         // Content hash for change detection
}
```

### 3.2 Export Types

```typescript
interface StreamExportInput {
  entityType: string
  cursor?: string                       // Last exported entity timestamp/ID
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  /** Filter to export only specific records */
  filter?: Record<string, unknown>
}

interface ExportBatch {
  results: ExportItemResult[]
  cursor: string
  hasMore: boolean
  batchIndex: number
}

interface ExportItemResult {
  localId: string
  externalId?: string     // ID assigned by external system (for create)
  status: 'success' | 'error' | 'skipped'
  error?: string
}
```

### 3.3 Mapping Types

```typescript
interface DataMapping {
  entityType: string
  fields: FieldMapping[]
  /** How to match external records to local ones */
  matchStrategy: 'externalId' | 'sku' | 'email' | 'custom'
  matchField?: string  // The field used for matching (e.g., 'sku' for products)
}

interface FieldMapping {
  externalField: string   // JSON path in external data (e.g., 'variants[0].price')
  localField: string      // Open Mercato field (e.g., 'basePrice')
  transform?: string      // Transform function name (e.g., 'centsToDecimal', 'lowercase')
  required?: boolean
  defaultValue?: unknown
}
```

---

## 4. Hub Module — `data_sync`

### 4.1 Module Structure

```
packages/core/src/modules/data_sync/
├── index.ts
├── acl.ts                       # data_sync.view, .run, .configure
├── di.ts                        # Sync service, adapter registry (resolves progressService from DI)
├── events.ts                    # Sync lifecycle events
├── setup.ts
├── lib/
│   ├── adapter.ts               # DataSyncAdapter interface + types
│   ├── adapter-registry.ts      # registerDataSyncAdapter / getAdapter
│   ├── sync-engine.ts           # Orchestrates streaming, batching, cursor persistence
│   ├── sync-run-service.ts      # CRUD for SyncRun entity
│   ├── id-mapping.ts            # lookupLocalId / lookupExternalId / storeExternalIdMapping
│   ├── transforms.ts            # Built-in field transforms
│   ├── rate-limiter.ts          # Token-bucket rate limiter for external API throttling
│   └── entity-writer.ts         # Generic entity upsert using mapping
├── data/
│   ├── entities.ts              # SyncRun, SyncCursor, SyncMapping, SyncExternalIdMapping, SyncSchedule
│   └── validators.ts
├── api/
│   ├── post/data-sync/run.ts    # Start a sync run
│   ├── get/data-sync/runs.ts    # List sync runs with progress
│   ├── get/data-sync/runs/[id].ts     # Sync run detail
│   ├── post/data-sync/runs/[id]/cancel.ts  # Cancel running sync
│   ├── post/data-sync/runs/[id]/retry.ts   # Retry failed sync from last cursor
│   ├── get/data-sync/mappings.ts      # List configured mappings
│   ├── put/data-sync/mappings/[id].ts # Save mapping config
│   └── post/data-sync/validate.ts     # Validate connection + mapping
├── workers/
│   ├── sync-import.ts           # Import worker — drives streamImport
│   ├── sync-export.ts           # Export worker — drives streamExport
│   └── sync-scheduler.ts        # Scheduled worker — checks SyncSchedule, enqueues due syncs
├── widgets/
│   ├── injection-table.ts       # Injects scheduler widget into all data_sync integrations
│   └── injection/
│       └── scheduler/
│           ├── widget.ts        # Widget metadata
│           └── widget.client.tsx # Scheduler configuration UI
├── backend/
│   └── data-sync/
│       ├── page.tsx             # /backend/data-sync — sync runs dashboard
│       └── runs/
│           └── [id]/page.tsx    # Sync run detail with progress
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 4.2 SyncRun Entity

Tracks each sync execution. **Progress tracking is delegated to the `progress` module** — each SyncRun creates a `ProgressJob` and updates it via `ProgressService`. The SyncRun stores sync-specific data (cursors, action counts) while the ProgressJob handles generic progress (percent, ETA, heartbeat, stale detection, UI display in `ProgressTopBar`).

```typescript
@Entity({ tableName: 'sync_runs' })
export class SyncRun extends BaseEntity {
  @Property()
  integrationId!: string  // e.g., 'sync_medusa_products'

  @Property()
  entityType!: string  // e.g., 'catalog.product'

  @Property({ length: 20 })
  direction!: 'import' | 'export'

  @Property({ length: 20 })
  status!: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

  /** Cursor to resume from (persisted after each successful batch) */
  @Property({ type: 'text', nullable: true })
  cursor?: string

  /** Cursor at the start of this run (for retry from beginning) */
  @Property({ type: 'text', nullable: true })
  initialCursor?: string

  /** Sync-specific action counters (not duplicated in ProgressJob) */
  @Property({ default: 0 })
  createdCount!: number

  @Property({ default: 0 })
  updatedCount!: number

  @Property({ default: 0 })
  skippedCount!: number

  @Property({ default: 0 })
  failedCount!: number

  @Property({ default: 0 })
  batchesCompleted!: number

  /** Error summary (last error message for UI display) */
  @Property({ type: 'text', nullable: true })
  lastError?: string

  /** Reference to the ProgressJob (progress module) for progress tracking + UI */
  @Property({ nullable: true })
  progressJobId?: string

  /** Job ID in the queue system (for cancellation) */
  @Property({ nullable: true })
  jobId?: string

  /** Who triggered the sync */
  @Property({ nullable: true })
  triggeredBy?: string  // User ID or 'scheduler' or 'webhook'

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string
}
```

> **Why not put everything on ProgressJob?** The `SyncRun` owns sync-specific semantics (cursors, action-level counters like `createdCount`/`updatedCount`, batch tracking). The `ProgressJob` owns generic progress display (percent, ETA, heartbeat, stale detection, ProgressTopBar rendering). The `progressJobId` links the two — the sync engine updates both in lockstep.

### 4.3 SyncCursor Entity

Persists the last successful cursor per integration + entity type for delta resumability:

```typescript
@Entity({ tableName: 'sync_cursors' })
export class SyncCursor extends BaseEntity {
  @Property()
  integrationId!: string

  @Property()
  entityType!: string

  @Property({ length: 20 })
  direction!: 'import' | 'export'

  @Property({ type: 'text' })
  cursor!: string  // Last successfully processed cursor

  @Property()
  lastSyncAt!: Date

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Unique({ properties: ['integrationId', 'entityType', 'direction', 'organizationId', 'tenantId'] })
  _unique!: never
}
```

### 4.4 SyncMapping Entity

Persists a configured field mapping for a given integration + entity type. Admin can customize the default mapping returned by `adapter.getMapping()`:

```typescript
@Entity({ tableName: 'sync_mappings' })
export class SyncMapping extends BaseEntity {
  @Property()
  integrationId!: string  // e.g., 'sync_medusa_products'

  @Property()
  entityType!: string  // e.g., 'catalog.product'

  @Property({ type: 'jsonb' })
  fields!: FieldMapping[]  // Customized field mappings

  @Property({ length: 30 })
  matchStrategy!: 'externalId' | 'sku' | 'email' | 'custom'

  @Property({ nullable: true })
  matchField?: string  // The field used for matching (e.g., 'sku' for products)

  @Property({ default: true })
  isActive!: boolean

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Unique({ properties: ['integrationId', 'entityType', 'organizationId', 'tenantId'] })
  _unique!: never
}
```

When the sync engine needs a mapping, it checks for a persisted `SyncMapping` first. If none exists, it falls back to the adapter's `getMapping()` default. This allows admin to customize field transforms, add/remove fields, or change the match strategy via the admin UI.

### 4.5 Sync Engine — Streaming Orchestration

The sync engine is the heart of the hub. It drives the adapter's async iterable, persists cursors, updates progress via **`ProgressService`**, and logs every step. The `ProgressJob` provides the unified progress bar, ETA, heartbeat, and stale detection — the sync engine focuses on sync-specific orchestration.

```typescript
// data_sync/lib/sync-engine.ts

export function createSyncEngine({ em, integrationLog, eventBus, progressService }: Dependencies) {
  return {
    async runImport(syncRun: SyncRun, adapter: DataSyncAdapter, input: StreamImportInput): Promise<void> {
      const log = integrationLog.scoped(syncRun.integrationId, syncRun.id, {
        organizationId: syncRun.organizationId,
        tenantId: syncRun.tenantId,
      })

      const progressCtx = {
        tenantId: syncRun.tenantId,
        organizationId: syncRun.organizationId,
        userId: syncRun.triggeredBy,
      }

      // Create a ProgressJob for unified progress tracking + ProgressTopBar UI
      const progressJob = await progressService.createJob({
        jobType: 'data_sync:import',
        name: `Importing ${input.entityType}`,
        description: `${syncRun.integrationId} — ${input.cursor ? 'delta sync' : 'full sync'}`,
        cancellable: true,
        meta: {
          syncRunId: syncRun.id,
          integrationId: syncRun.integrationId,
          entityType: input.entityType,
          direction: 'import',
        },
      }, progressCtx)

      syncRun.progressJobId = progressJob.id
      syncRun.status = 'running'
      await em.flush()

      await progressService.startJob(progressJob.id, progressCtx)

      await log.info('sync.import.started', `Starting ${input.entityType} import`, {
        cursor: input.cursor ?? 'full-sync',
        batchSize: input.batchSize,
        progressJobId: progressJob.id,
      })

      let processedCount = 0

      try {
        for await (const batch of adapter.streamImport!(input)) {
          // Check if sync was cancelled (via ProgressService cancellation)
          if (await progressService.isCancellationRequested(progressJob.id)) {
            syncRun.status = 'cancelled'
            await em.flush()
            await progressService.cancelJob(progressJob.id, progressCtx)
            await log.info('sync.import.cancelled', 'Sync cancelled by user')
            return
          }

          // Set totalEstimate on first batch (if adapter provides it)
          if (batch.totalEstimate && batch.batchIndex === 0) {
            await progressService.updateProgress(progressJob.id, {
              totalCount: batch.totalEstimate,
            }, progressCtx)
          }

          // Process each item in the batch
          for (const item of batch.items) {
            try {
              await processImportItem(item, input, em)

              if (item.action === 'create') syncRun.createdCount++
              else if (item.action === 'update') syncRun.updatedCount++
              else syncRun.skippedCount++

              processedCount++
            } catch (err) {
              syncRun.failedCount++
              processedCount++
              syncRun.lastError = err.message

              await log.error('sync.import.item_failed', `Failed: ${item.externalId}`, {
                externalId: item.externalId,
                error: err.message,
                entityType: input.entityType,
              })
              // Continue processing — don't fail the whole batch for one item
            }
          }

          // Persist cursor after each successful batch
          syncRun.cursor = batch.cursor
          syncRun.batchesCompleted = batch.batchIndex + 1
          await em.flush()

          // Update progress via ProgressService (auto-calculates percent + ETA + heartbeat)
          await progressService.updateProgress(progressJob.id, {
            processedCount,
            meta: {
              createdCount: syncRun.createdCount,
              updatedCount: syncRun.updatedCount,
              failedCount: syncRun.failedCount,
              batchesCompleted: syncRun.batchesCompleted,
              cursor: batch.cursor,
            },
          }, progressCtx)

          // Update the global cursor for next delta run
          await persistSyncCursor(syncRun.integrationId, input.entityType, 'import', batch.cursor, em)

          await log.info('sync.import.batch', `Batch ${batch.batchIndex + 1}: +${batch.items.length} items`, {
            batchIndex: batch.batchIndex,
            processedCount,
            createdCount: syncRun.createdCount,
            updatedCount: syncRun.updatedCount,
            failedCount: syncRun.failedCount,
            cursor: batch.cursor,
          })

          if (!batch.hasMore) break
        }

        syncRun.status = 'completed'
        await em.flush()

        await progressService.completeJob(progressJob.id, {
          resultSummary: {
            createdCount: syncRun.createdCount,
            updatedCount: syncRun.updatedCount,
            skippedCount: syncRun.skippedCount,
            failedCount: syncRun.failedCount,
            batchesCompleted: syncRun.batchesCompleted,
          },
        })

        await log.info('sync.import.completed', `Import complete: ${syncRun.createdCount} created, ${syncRun.updatedCount} updated, ${syncRun.failedCount} failed`, {
          createdCount: syncRun.createdCount,
          updatedCount: syncRun.updatedCount,
          skippedCount: syncRun.skippedCount,
          failedCount: syncRun.failedCount,
        })

        await eventBus.emit('data_sync.run.completed', { syncRunId: syncRun.id })

      } catch (err) {
        syncRun.status = 'failed'
        syncRun.lastError = err.message
        await em.flush()

        await progressService.failJob(progressJob.id, {
          errorMessage: err.message,
          errorStack: err.stack,
        })

        await log.error('sync.import.failed', `Import failed: ${err.message}`, {
          error: err.message,
          stack: err.stack,
          processedBeforeFailure: processedCount,
          lastCursor: syncRun.cursor,
        })

        await eventBus.emit('data_sync.run.failed', { syncRunId: syncRun.id, error: err.message })
      }
    },
  }
}
```

### 4.6 Import Worker

The worker resolves `progressService` from the DI container and passes it to the sync engine:

```typescript
// data_sync/workers/sync-import.ts

export const metadata: WorkerMeta = {
  queue: 'data-sync-import',
  id: 'data-sync-import-worker',
  concurrency: 3,  // Max 3 parallel syncs (I/O-bound, external API rate limits)
}

export default async function handler(job: Job, ctx: WorkerContext) {
  const { syncRunId } = job.data
  const progressService = ctx.container.resolve('progressService') as ProgressService

  const syncRun = await ctx.em.findOneOrFail(SyncRun, {
    id: syncRunId,
    organizationId: job.data.organizationId,
  })

  const adapter = getDataSyncAdapter(syncRun.integrationId)
  if (!adapter?.streamImport) {
    throw new Error(`Adapter ${syncRun.integrationId} does not support import`)
  }

  const credentials = await ctx.integrationCredentials.resolve(syncRun.integrationId, {
    organizationId: syncRun.organizationId,
    tenantId: syncRun.tenantId,
  })

  const mapping = await loadMapping(syncRun.integrationId, syncRun.entityType, ctx.em)

  await ctx.syncEngine.runImport(syncRun, adapter, {
    entityType: syncRun.entityType,
    cursor: syncRun.cursor ?? undefined,
    batchSize: 100,
    credentials,
    mapping,
    scope: { organizationId: syncRun.organizationId, tenantId: syncRun.tenantId },
  })
}
```

### 4.7 Progress API

The data_sync module exposes two levels of progress:

1. **Generic progress (via progress module)**: The `ProgressTopBar` automatically shows active sync jobs (job type `data_sync:import` / `data_sync:export`) with progress bars, ETAs, and cancel buttons — polling `GET /api/progress/active`. **No custom UI code needed** for the top bar.

2. **Sync-specific detail**: The `GET /api/data-sync/runs/:id` endpoint returns sync-specific data (cursors, action counters, error logs) alongside the linked `ProgressJob` data:

```
GET /api/data-sync/runs/abc123

→ 200: {
  id: 'abc123',
  integrationId: 'sync_medusa_products',
  entityType: 'catalog.product',
  direction: 'import',
  status: 'running',
  createdCount: 12000,
  updatedCount: 22400,
  skippedCount: 0,
  failedCount: 100,
  batchesCompleted: 345,
  cursor: '2026-02-24T13:58:00Z',
  lastError: 'Invalid SKU format for product xyz-123',
  // Progress data from the linked ProgressJob:
  progressJob: {
    id: 'pj-xyz',
    progressPercent: 69,
    processedCount: 34500,
    totalCount: 50000,
    etaSeconds: 52,
    status: 'running',
    startedAt: '2026-02-24T14:00:00Z',
    cancellable: true,
  },
}
```

### 4.8 Progress UI

**Top bar (automatic)**: The `ProgressTopBar` (from the `progress` module) automatically picks up active `data_sync:import` / `data_sync:export` jobs. Admin sees progress bars, ETAs, and cancel buttons without any custom data_sync UI code.

**Sync run detail page**: The `/backend/data-sync/runs/[id]` page shows sync-specific details (action counters, error log, retry) that go beyond the generic progress bar:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Data Sync Runs                                                   │
│                                                                     │
│  MedusaJS — Products                              Status: Running  │
│  Import • Started 2 min ago by admin@example.com                   │
│                                                                     │
│  ── Progress (from ProgressJob) ──────────────────────────────────  │
│  [████████████████████░░░░░░░░] 69%   34,500 / ~50,000            │
│  ~52s remaining                                                    │
│                                                                     │
│  Created:  12,000   Updated:  22,400   Skipped:  0   Failed:  100  │
│  Batches:  345 completed                                           │
│                                                                     │
│  ── Recent Errors (100 total) ────────────────── [View All Logs]   │
│  ❌ sync.import.item_failed — Invalid SKU format for product xyz-..│
│  ❌ sync.import.item_failed — Missing required field 'title' for.. │
│  ❌ sync.import.item_failed — Duplicate SKU 'ABC-001' conflicts... │
│                                                                     │
│                                      [Cancel Sync] [Retry Failed]  │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.9 Retry & Resume

**Resume after failure**: When a sync run fails mid-way (e.g., network error at batch 345), the `cursor` is already persisted at batch 344. Clicking "Retry" creates a new `SyncRun` (and a new `ProgressJob`) with `initialCursor = syncRun.cursor`, so it picks up where it left off.

**Cancellation**: Admin can cancel a running sync via the `ProgressTopBar` cancel button or the sync run detail page. Both use `progressService.cancelJob()` — the sync engine checks `progressService.isCancellationRequested()` at each batch boundary and stops gracefully.

**Retry failed items**: After a completed sync with `failedCount > 0`, admin can view the failed items via logs (filtered by `correlationId = syncRunId, level = error`) and trigger a targeted re-import of just those items.

```
POST /api/data-sync/runs/abc123/retry

→ 201: {
  id: 'def456',  // New sync run
  status: 'pending',
  initialCursor: 'cursor-from-batch-344',  // Resumes, not restarts
}
```

**Full re-sync**: Admin can also trigger a "Full Sync" that resets the cursor to null, importing everything from scratch.

```
POST /api/data-sync/run
{
  "integrationId": "sync_medusa_products",
  "entityType": "catalog.product",
  "direction": "import",
  "fullSync": true  // Ignores saved cursor
}
```

### 4.10 Events

```typescript
export const eventsConfig = createModuleEvents('data_sync', [
  { id: 'data_sync.run.started', label: 'Sync Run Started', entity: 'run', category: 'lifecycle' },
  { id: 'data_sync.run.completed', label: 'Sync Run Completed', entity: 'run', category: 'lifecycle' },
  { id: 'data_sync.run.failed', label: 'Sync Run Failed', entity: 'run', category: 'lifecycle' },
  { id: 'data_sync.run.cancelled', label: 'Sync Run Cancelled', entity: 'run', category: 'lifecycle' },
  { id: 'data_sync.batch.completed', label: 'Batch Completed', entity: 'batch', category: 'system' },
] as const)
```

---

## 5. Reference Implementation — `sync_medusa` Bundle

A platform connector like MedusaJS is **not just an ETL pipeline**. It has two operational modes:

| Mode | Mechanism | When Used |
|------|-----------|-----------|
| **Batch sync** | `DataSyncAdapter.streamImport()` / `streamExport()` | Initial data migration, catch-up after downtime, scheduled full reconciliation |
| **Real-time sync** | Event subscribers + inbound webhooks | Ongoing operation — order status changes, inventory updates, new products |

Batch sync bootstraps the data. Real-time sync keeps it current. Both use the same field mapping, credentials, and logging infrastructure.

### 5.1 Module Structure

```
packages/core/src/modules/sync_medusa/
├── index.ts                    # Module metadata
├── integration.ts              # Bundle + integration definitions (§1.2 in SPEC-045a)
├── setup.ts                    # Register adapters, status maps, webhook adapter
├── di.ts                       # Medusa client, health check
├── lib/
│   ├── client.ts               # MedusaJS REST client (streaming-capable)
│   ├── status-map.ts           # Bidirectional status mapping
│   ├── adapters/
│   │   ├── products.ts         # DataSyncAdapter for products (batch)
│   │   ├── customers.ts        # DataSyncAdapter for customers (batch)
│   │   ├── orders.ts           # DataSyncAdapter for orders (batch)
│   │   └── inventory.ts        # DataSyncAdapter for inventory (batch)
│   ├── webhooks/
│   │   └── adapter.ts          # WebhookEndpointAdapter for inbound Medusa events
│   ├── transforms.ts           # Medusa-specific field transforms
│   └── health.ts               # HealthCheckable implementation
├── subscribers/
│   ├── order-status-changed.ts # React to local order status → push to Medusa
│   ├── order-created.ts        # React to local order creation → push to Medusa
│   ├── product-updated.ts      # React to local product edit → push to Medusa
│   ├── inventory-adjusted.ts   # React to local stock change → push to Medusa
│   └── shipment-created.ts     # React to local shipment → mark fulfilled in Medusa
├── workers/
│   └── outbound-push.ts        # Async worker for pushing changes to Medusa API
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 5.2 Two Sync Modes — How They Complement Each Other

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MODE 1: BATCH SYNC (DataSyncAdapter)                                   │
│  • Initial migration: "Import all 50K products from Medusa"            │
│  • Scheduled reconciliation: "Nightly full delta sync"                  │
│  • Catch-up: "Sync everything changed in the last 7 days"              │
│                                                                         │
│  Uses: streamImport() / streamExport() → queue → progress bar           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  MODE 2: REAL-TIME SYNC (Events + Webhooks)                             │
│                                                                         │
│  OUTBOUND (Open Mercato → Medusa):                                      │
│  • Event subscribers listen to local events                             │
│  • Enqueue outbound push via worker (not inline — fault-tolerant)       │
│  • Worker calls Medusa API, logs via integrationLog                     │
│                                                                         │
│  sales.order.status_changed ──► subscriber ──► worker ──► Medusa API    │
│  catalog.product.updated    ──► subscriber ──► worker ──► Medusa API    │
│  sales.shipment.created     ──► subscriber ──► worker ──► Medusa API    │
│                                                                         │
│  INBOUND (Medusa → Open Mercato):                                       │
│  • Medusa sends webhooks to /api/webhook-endpoints/webhook/medusa       │
│  • WebhookEndpointAdapter verifies + parses                             │
│  • Worker processes: creates/updates local entities via commands         │
│                                                                         │
│  Medusa webhook ──► verify ──► worker ──► local command (create order)  │
│                                                                         │
│  Uses: subscribers, workers, webhook_endpoints hub, integrationLog      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Status Mapping — Bidirectional

A platform connector must map statuses between the two systems. This is a core concern — different platforms use different status vocabularies.

```typescript
// sync_medusa/lib/status-map.ts

/**
 * Bidirectional order status mapping between Medusa and Open Mercato.
 * Used by both outbound subscribers (local → Medusa) and inbound webhooks (Medusa → local).
 */

/** Open Mercato order status → Medusa fulfillment/payment actions */
const outboundOrderStatusMap: Record<string, MedusaAction> = {
  'confirmed':    { action: 'none' },                              // No Medusa action needed
  'processing':   { action: 'none' },
  'shipped':      { action: 'create_fulfillment', shipAll: true }, // Create fulfillment in Medusa
  'delivered':    { action: 'create_fulfillment', shipAll: true, markDelivered: true },
  'cancelled':    { action: 'cancel_order' },                     // Cancel order in Medusa
  'refunded':     { action: 'create_refund' },                    // Refund via Medusa
}

/** Medusa webhook event → Open Mercato order status + actions */
const inboundEventMap: Record<string, LocalAction> = {
  'order.placed':              { createOrder: true },              // Create new order locally
  'order.updated':             { updateOrder: true },
  'order.canceled':            { status: 'cancelled' },
  'order.payment_captured':    { status: 'paid', capturePayment: true },
  'order.fulfillment_created': { status: 'shipped', createShipment: true },
  'order.shipment_created':    { status: 'shipped', updateTracking: true },
  'order.return_requested':    { status: 'return_requested' },
  'order.items_returned':      { status: 'returned' },
  'order.refund_created':      { status: 'refunded', createRefund: true },
}

/** Medusa product status → Open Mercato isActive */
function medusaProductStatusToLocal(medusaStatus: string): boolean {
  return medusaStatus === 'published'
  // 'draft' | 'proposed' | 'rejected' → isActive: false
}

/** Open Mercato isActive → Medusa product status */
function localProductStatusToMedusa(isActive: boolean): string {
  return isActive ? 'published' : 'draft'
}

interface MedusaAction {
  action: 'none' | 'create_fulfillment' | 'cancel_order' | 'create_refund'
  shipAll?: boolean
  markDelivered?: boolean
}

interface LocalAction {
  createOrder?: boolean
  updateOrder?: boolean
  createShipment?: boolean
  updateTracking?: boolean
  capturePayment?: boolean
  createRefund?: boolean
  status?: string
}
```

### 5.4 Outbound Event Subscribers (Open Mercato → Medusa)

Each subscriber listens to a local event and enqueues an outbound push job. The subscriber is **thin** — it only checks if the Medusa integration is enabled and enqueues. The **worker** does the actual API call.

```typescript
// sync_medusa/subscribers/order-status-changed.ts

export const metadata = {
  event: 'sales.order.status_changed',
  persistent: true,
  id: 'sync_medusa.order_status_push',
}

export default async function handler(event: OrderStatusChangedEvent, ctx: SubscriberContext) {
  // 1. Check if Medusa integration is enabled for this tenant
  const enabled = await ctx.integrationState.isEnabled('sync_medusa_orders', {
    organizationId: event.organizationId,
    tenantId: event.tenantId,
  })
  if (!enabled) return

  // 2. Look up the status action
  const action = outboundOrderStatusMap[event.newStatus]
  if (!action || action.action === 'none') return

  // 3. Enqueue outbound push (not inline — decoupled for fault tolerance)
  await ctx.enqueueJob('medusa-outbound-push', {
    type: 'order_status',
    orderId: event.orderId,
    newStatus: event.newStatus,
    previousStatus: event.previousStatus,
    action,
    organizationId: event.organizationId,
    tenantId: event.tenantId,
  })
}
```

```typescript
// sync_medusa/subscribers/shipment-created.ts

export const metadata = {
  event: 'sales.shipment.created',
  persistent: true,
  id: 'sync_medusa.shipment_push',
}

export default async function handler(event: ShipmentCreatedEvent, ctx: SubscriberContext) {
  const enabled = await ctx.integrationState.isEnabled('sync_medusa_orders', {
    organizationId: event.organizationId,
    tenantId: event.tenantId,
  })
  if (!enabled) return

  await ctx.enqueueJob('medusa-outbound-push', {
    type: 'fulfillment',
    orderId: event.orderId,
    shipmentId: event.shipmentId,
    trackingNumber: event.trackingNumber,
    carrier: event.carrier,
    items: event.items,  // Which line items were shipped
    organizationId: event.organizationId,
    tenantId: event.tenantId,
  })
}
```

```typescript
// sync_medusa/subscribers/product-updated.ts

export const metadata = {
  event: 'catalog.product.updated',
  persistent: true,
  id: 'sync_medusa.product_push',
}

export default async function handler(event: ProductUpdatedEvent, ctx: SubscriberContext) {
  const enabled = await ctx.integrationState.isEnabled('sync_medusa_products', {
    organizationId: event.organizationId,
    tenantId: event.tenantId,
  })
  if (!enabled) return

  await ctx.enqueueJob('medusa-outbound-push', {
    type: 'product_update',
    productId: event.productId,
    changedFields: event.changedFields,
    organizationId: event.organizationId,
    tenantId: event.tenantId,
  })
}
```

### 5.5 Outbound Push Worker

The worker handles all outbound pushes to Medusa. It resolves credentials, calls the Medusa API, and logs everything.

```typescript
// sync_medusa/workers/outbound-push.ts

export const metadata: WorkerMeta = {
  queue: 'medusa-outbound-push',
  id: 'medusa-outbound-push-worker',
  concurrency: 5,
}

export default async function handler(job: Job, ctx: WorkerContext) {
  const { type, organizationId, tenantId } = job.data
  const scope = { organizationId, tenantId }

  const credentials = await ctx.integrationCredentials.resolve('sync_medusa', scope)
  const client = createMedusaClient(credentials)
  const log = ctx.integrationLog.scoped('sync_medusa_orders', job.id, scope)

  try {
    switch (type) {
      case 'order_status': {
        const { orderId, newStatus, action } = job.data

        if (action.action === 'cancel_order') {
          // Look up the Medusa order ID from our sync mapping
          const medusaOrderId = await lookupExternalId('sales.order', orderId, scope, ctx.em)
          if (!medusaOrderId) {
            await log.warning('push.skip', `Order ${orderId} not synced to Medusa — skipping cancel`)
            return
          }
          await client.cancelOrder(medusaOrderId)
          await log.info('push.order_cancelled', `Cancelled Medusa order ${medusaOrderId}`, {
            localOrderId: orderId,
            medusaOrderId,
          })
        }

        if (action.action === 'create_refund') {
          const medusaOrderId = await lookupExternalId('sales.order', orderId, scope, ctx.em)
          if (!medusaOrderId) return
          // Load refund details from local order
          const refundData = await loadRefundData(orderId, ctx.em)
          await client.createRefund(medusaOrderId, refundData)
          await log.info('push.refund_created', `Created refund on Medusa order ${medusaOrderId}`, {
            localOrderId: orderId,
            medusaOrderId,
            amount: refundData.amount,
          })
        }
        break
      }

      case 'fulfillment': {
        const { orderId, shipmentId, trackingNumber, carrier, items } = job.data
        const medusaOrderId = await lookupExternalId('sales.order', orderId, scope, ctx.em)
        if (!medusaOrderId) {
          await log.warning('push.skip', `Order ${orderId} not synced to Medusa — skipping fulfillment`)
          return
        }

        const fulfillment = await client.createFulfillment(medusaOrderId, {
          items: items.map((i: LineItemRef) => ({
            item_id: i.medusaLineItemId,
            quantity: i.quantity,
          })),
          tracking_numbers: trackingNumber ? [trackingNumber] : [],
          // No provider ID needed — Medusa auto-resolves
        })

        await log.info('push.fulfillment_created', `Created fulfillment on Medusa order ${medusaOrderId}`, {
          localOrderId: orderId,
          localShipmentId: shipmentId,
          medusaOrderId,
          medusaFulfillmentId: fulfillment.id,
          trackingNumber,
          carrier,
        })
        break
      }

      case 'product_update': {
        const { productId, changedFields } = job.data
        const medusaProductId = await lookupExternalId('catalog.product', productId, scope, ctx.em)
        if (!medusaProductId) {
          await log.warning('push.skip', `Product ${productId} not synced to Medusa — skipping update`)
          return
        }

        // Load current product, map fields, push to Medusa
        const localProduct = await loadProduct(productId, ctx.em)
        const medusaData = mapLocalToMedusa(localProduct, changedFields)
        await client.updateProduct(medusaProductId, medusaData)

        await log.info('push.product_updated', `Updated Medusa product ${medusaProductId}`, {
          localProductId: productId,
          medusaProductId,
          changedFields,
        })
        break
      }
    }
  } catch (err) {
    await log.error(`push.${type}_failed`, `Failed to push ${type}: ${err.message}`, {
      error: err.message,
      stack: err.stack,
      jobData: job.data,
    })
    throw err  // Let worker retry with backoff
  }
}
```

### 5.6 Inbound Webhooks (Medusa → Open Mercato)

The Medusa bundle also registers a `WebhookEndpointAdapter` (from the `webhook_endpoints` hub) to receive events FROM Medusa:

```typescript
// sync_medusa/lib/webhooks/adapter.ts

export const medusaWebhookAdapter: WebhookEndpointAdapter = {
  providerKey: 'medusa_webhooks',

  subscribedEvents: [
    'order.placed',
    'order.updated',
    'order.canceled',
    'order.payment_captured',
    'order.fulfillment_created',
    'order.shipment_created',
    'order.return_requested',
    'order.items_returned',
    'order.refund_created',
    'product.created',
    'product.updated',
    'product.deleted',
    'inventory-item.updated',
  ],

  async verifyWebhook(input: VerifyWebhookInput): Promise<InboundWebhookEvent> {
    // Medusa signs webhooks with HMAC-SHA256 using the webhook secret
    const expectedSignature = crypto
      .createHmac('sha256', input.settings.medusaWebhookSecret as string)
      .update(input.body)
      .digest('hex')

    const receivedSignature = input.headers['x-medusa-signature']
    if (receivedSignature !== expectedSignature) {
      throw new Error('Invalid Medusa webhook signature')
    }

    const payload = JSON.parse(input.body)
    return {
      eventType: payload.event,          // e.g., 'order.placed'
      externalId: payload.data.id,       // Medusa entity ID
      data: payload.data,                // Full entity data
      idempotencyKey: payload.id,        // Unique event ID from Medusa
      timestamp: payload.timestamp,
    }
  },

  async processInbound(event: InboundWebhookEvent): Promise<void> {
    // Dispatched by the webhook_endpoints hub to the sync_medusa worker
    // The hub enqueues to 'medusa-inbound-webhook' queue
  },

  async formatPayload(): Promise<WebhookPayload> {
    // Not used — Medusa is an inbound-only webhook for this adapter
    throw new Error('Medusa webhook adapter is inbound-only')
  },
}
```

### 5.7 Inbound Webhook Processing — Order Flow Example

When Medusa sends `order.placed`, the full lifecycle:

```
Medusa API                        Open Mercato
─────────                        ──────────────
order.placed webhook ───────────► POST /api/webhook-endpoints/webhook/medusa_webhooks
                                  │
                                  ├─ verify HMAC signature
                                  ├─ idempotency check (skip if duplicate)
                                  ├─ enqueue to 'medusa-inbound-webhook' queue
                                  └─ 200 OK (fast response)

                                  Worker picks up job:
                                  │
                                  ├─ Parse event: 'order.placed'
                                  ├─ Look up action: { createOrder: true }
                                  ├─ Map Medusa order → local SalesDocument fields:
                                  │   ├─ customer email → resolve local person
                                  │   ├─ line items → resolve local products by SKU
                                  │   ├─ shipping → resolve local shipping method
                                  │   ├─ payment → resolve local payment method
                                  │   └─ addresses → map to local address format
                                  ├─ Execute createOrderCommand (existing sales module command)
                                  ├─ Store external ID mapping: medusa_order_123 ↔ local_order_456
                                  ├─ Log: "Created order local_order_456 from Medusa order medusa_order_123"
                                  └─ Done

Later: order.payment_captured ──► same flow → updatePaymentStatus('paid')
Later: order.fulfillment_created ► same flow → local status stays (Medusa confirms our push)
```

```typescript
// sync_medusa/workers/inbound-webhook.ts (registered via webhook_endpoints hub)

export const metadata: WorkerMeta = {
  queue: 'medusa-inbound-webhook',
  id: 'medusa-inbound-webhook-worker',
  concurrency: 5,
}

export default async function handler(job: Job, ctx: WorkerContext) {
  const { event, scope } = job.data
  const log = ctx.integrationLog.scoped('sync_medusa_orders', event.idempotencyKey, scope)

  const action = inboundEventMap[event.eventType]
  if (!action) {
    await log.debug('webhook.skip', `Unhandled event type: ${event.eventType}`)
    return
  }

  await log.info('webhook.processing', `Processing ${event.eventType}`, {
    medusaId: event.externalId,
    eventType: event.eventType,
  })

  try {
    if (action.createOrder) {
      // Map Medusa order to local format
      const localOrder = await mapMedusaOrderToLocal(event.data, ctx)
      const result = await ctx.salesCommands.createOrder(localOrder)

      // Store the external ID mapping for future lookups
      await storeExternalIdMapping('sales.order', result.id, event.externalId, scope, ctx.em)

      // Also map line item IDs for fulfillment tracking
      for (const lineItem of event.data.items) {
        const localLineItem = result.lineItems.find(
          (li: LineItem) => li.sku === lineItem.variant.sku
        )
        if (localLineItem) {
          await storeExternalIdMapping(
            'sales.line_item', localLineItem.id, lineItem.id, scope, ctx.em,
          )
        }
      }

      await log.info('webhook.order_created', `Created local order ${result.id} from Medusa ${event.externalId}`, {
        localOrderId: result.id,
        medusaOrderId: event.externalId,
        lineItemCount: result.lineItems.length,
        total: result.total,
      })
    }

    if (action.status) {
      const localOrderId = await lookupLocalId('sales.order', event.externalId, scope, ctx.em)
      if (!localOrderId) {
        await log.warning('webhook.skip', `Medusa order ${event.externalId} not found locally`)
        return
      }

      await ctx.salesCommands.updateOrderStatus(localOrderId, action.status)
      await log.info('webhook.status_updated', `Order ${localOrderId} → ${action.status}`, {
        localOrderId,
        medusaOrderId: event.externalId,
        newStatus: action.status,
      })
    }

    if (action.createShipment) {
      const localOrderId = await lookupLocalId('sales.order', event.externalId, scope, ctx.em)
      if (!localOrderId) return

      const fulfillment = event.data  // Medusa fulfillment object
      await ctx.salesCommands.createShipment({
        orderId: localOrderId,
        trackingNumber: fulfillment.tracking_numbers?.[0],
        items: fulfillment.items.map((fi: FulfillmentItem) => ({
          lineItemId: lookupLocalId('sales.line_item', fi.item_id, scope, ctx.em),
          quantity: fi.quantity,
        })),
      })
      await log.info('webhook.shipment_created', `Created shipment for order ${localOrderId}`, {
        localOrderId,
        trackingNumber: fulfillment.tracking_numbers?.[0],
      })
    }

    if (action.createRefund) {
      const localOrderId = await lookupLocalId('sales.order', event.externalId, scope, ctx.em)
      if (!localOrderId) return

      const refund = event.data
      await ctx.salesCommands.createRefund({
        orderId: localOrderId,
        amount: refund.amount / 100,  // Medusa stores in cents
        reason: refund.reason,
      })
      await log.info('webhook.refund_created', `Created refund for order ${localOrderId}`, {
        localOrderId,
        amount: refund.amount / 100,
        reason: refund.reason,
      })
    }

  } catch (err) {
    await log.error('webhook.processing_failed', `Failed to process ${event.eventType}: ${err.message}`, {
      error: err.message,
      stack: err.stack,
      medusaId: event.externalId,
      eventType: event.eventType,
    })
    throw err  // Worker retries with backoff
  }
}
```

### 5.8 External ID Mapping

A critical piece for bidirectional sync is knowing which Medusa entity corresponds to which local entity:

```typescript
// data_sync/data/entities.ts

@Entity({ tableName: 'sync_external_id_mappings' })
export class SyncExternalIdMapping extends BaseEntity {
  @Property()
  integrationId!: string  // 'sync_medusa'

  @Property()
  entityType!: string  // 'sales.order', 'catalog.product', 'sales.line_item'

  @Property()
  localId!: string  // Open Mercato entity ID

  @Property()
  externalId!: string  // Medusa entity ID

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Unique({ properties: ['integrationId', 'entityType', 'externalId', 'organizationId', 'tenantId'] })
  _unique!: never
}
```

Lookup helpers:
```typescript
// data_sync/lib/id-mapping.ts

/** Find the local entity ID for an external ID */
async function lookupLocalId(entityType: string, externalId: string, scope: TenantScope, em: EntityManager): Promise<string | null>

/** Find the external ID for a local entity */
async function lookupExternalId(entityType: string, localId: string, scope: TenantScope, em: EntityManager): Promise<string | null>

/** Store a new mapping (idempotent — upsert) */
async function storeExternalIdMapping(entityType: string, localId: string, externalId: string, scope: TenantScope, em: EntityManager): Promise<void>
```

This table is populated by:
- Batch imports (each imported item stores its external ID mapping)
- Inbound webhooks (when creating a local entity from a Medusa event)
- Outbound pushes (when creating an entity in Medusa from a local event, store the returned Medusa ID)

### 5.9 Conflict Prevention — Loop Detection

Since changes flow both ways, a naive implementation would create infinite loops:

```
Local order status → 'shipped' → subscriber → push to Medusa
                                                    ↓
Medusa webhook 'order.fulfillment_created' → update local → 'shipped' → subscriber → push to Medusa → ...
```

Prevention strategy — **origin tagging**:

```typescript
// When processing an inbound webhook, tag the resulting command with origin
await ctx.salesCommands.updateOrderStatus(localOrderId, action.status, {
  metadata: { _syncOrigin: 'sync_medusa' },  // Tag the mutation origin
})

// In the outbound subscriber, skip events that originated from this integration
export default async function handler(event: OrderStatusChangedEvent, ctx: SubscriberContext) {
  // Skip if this change was caused by our own inbound sync
  if (event.metadata?._syncOrigin === 'sync_medusa') return

  // ... proceed with outbound push
}
```

### 5.10 Batch Sync Adapters (Products Example)

The batch sync adapters handle the initial data migration and scheduled reconciliation. They use the same field mapping and status maps as the real-time sync:

```typescript
// sync_medusa/lib/adapters/products.ts

export const medusaProductsAdapter: DataSyncAdapter = {
  providerKey: 'medusa_products',
  direction: 'bidirectional',
  supportedEntities: ['catalog.product'],

  async *streamImport(input: StreamImportInput): AsyncIterable<ImportBatch> {
    const client = createMedusaClient(input.credentials)
    let batchIndex = 0

    for await (const page of client.streamProducts(input.cursor, input.batchSize)) {
      const items: ImportItem[] = page.items.map(product => ({
        externalId: product.id,
        data: product,
        action: determineAction(product, input),
        hash: computeHash(product),
      }))

      yield {
        items,
        cursor: page.nextCursor ?? `end:${Date.now()}`,
        hasMore: page.nextCursor !== null,
        totalEstimate: page.totalCount,
        batchIndex: batchIndex++,
      }
    }
  },

  async *streamExport(input: StreamExportInput): AsyncIterable<ExportBatch> {
    // Stream local products, push to Medusa API in batches
  },

  async getMapping(): Promise<DataMapping> {
    return {
      entityType: 'catalog.product',
      matchStrategy: 'externalId',
      fields: [
        { externalField: 'title', localField: 'title' },
        { externalField: 'handle', localField: 'slug' },
        { externalField: 'description', localField: 'description' },
        { externalField: 'status', localField: 'isActive', transform: 'medusaStatusToBoolean' },
        { externalField: 'variants[0].prices[0].amount', localField: 'basePrice', transform: 'centsToDecimal' },
        { externalField: 'variants[0].sku', localField: 'sku' },
        { externalField: 'images[0].url', localField: 'imageUrl' },
      ],
    }
  },

  async validateConnection(input): Promise<ValidationResult> {
    try {
      const client = createMedusaClient(input.credentials)
      const page = await client.streamProducts(undefined, 1)
      const first = (await page[Symbol.asyncIterator]().next()).value
      return { valid: true, message: `Connected. Found ${first.totalCount} products.` }
    } catch (err) {
      return { valid: false, message: err.message }
    }
  },
}
```

### 5.11 Delta Detection

For MedusaJS, delta detection works via `updated_at` ordering:
1. First sync: cursor = null, all items are `create`
2. Subsequent syncs: cursor = timestamp of last sync, API filters by `updated_at > cursor`
3. For each item, check `SyncExternalIdMapping` — if mapping exists → `update`, else → `create`

### 5.12 Setup — Registration

```typescript
// sync_medusa/setup.ts

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['data_sync.*'],
    admin: ['data_sync.view', 'data_sync.run'],
  },

  async onTenantCreated() {
    // Batch sync adapters
    registerDataSyncAdapter(medusaProductsAdapter)
    registerDataSyncAdapter(medusaCustomersAdapter)
    registerDataSyncAdapter(medusaOrdersAdapter)
    registerDataSyncAdapter(medusaInventoryAdapter)

    // Inbound webhook adapter
    registerWebhookEndpointAdapter(medusaWebhookAdapter)
  },
}
```

### 5.13 Full Lifecycle Example — Order Flow

Here is the complete flow for a Medusa ↔ Open Mercato order lifecycle:

```
TIME   MEDUSA                        OPEN MERCATO                      DIRECTION
─────  ──────                        ──────────────                    ─────────
T0     Customer places order  ──────► webhook: order.placed            INBOUND
                                      → Create local order (draft)
                                      → Store ID mapping
                                      → Log: "Order created"

T1     Payment captured      ──────► webhook: order.payment_captured   INBOUND
                                      → Update payment status → 'paid'
                                      → Log: "Payment captured"

T2                                    Staff confirms order              LOCAL
                                      → Status: 'confirmed'
                                      (No outbound push — Medusa
                                       doesn't have a 'confirmed'
                                       status. Controlled by status map)

T3                                    Staff creates shipment            LOCAL
                                      → Status: 'shipped'
                              ◄────── subscriber: sales.shipment.created OUTBOUND
                                      → Worker: create fulfillment
                                        in Medusa with tracking #
                                      → Log: "Fulfillment created"

T4     Medusa confirms       ──────► webhook: order.fulfillment_created INBOUND
       fulfillment created            → Skip (origin: sync_medusa via   (LOOP
                                        loop detection)                 PREVENTED)

T5                                    Customer requests return          LOCAL
                                      → Status: 'return_requested'
                              ◄────── subscriber: (no outbound push —   SKIP
                                       Medusa doesn't have this status)

T6                                    Staff processes refund            LOCAL
                                      → Status: 'refunded'
                              ◄────── subscriber: sales.order.          OUTBOUND
                                        status_changed
                                      → Worker: create refund in Medusa
                                      → Log: "Refund created"
```

---

## 6. Widget Injection — Configuration & Scheduler

Every data sync integration needs two things beyond credentials: **field mapping configuration** and **schedule configuration**. Both are delivered as injected React widgets on the integration detail page (see [SPEC-045a §9](./SPEC-045a-foundation.md#9-widget-injection-for-integration-configuration)).

### 6.1 Scheduler Widget — `data_sync.injection.scheduler`

The `data_sync` hub module provides a **shared scheduler widget** that injects into every data sync integration's detail page. Admin can configure periodic sync schedules per integration.

#### SyncSchedule Entity

```typescript
@Entity({ tableName: 'sync_schedules' })
export class SyncSchedule extends BaseEntity {
  @Property()
  integrationId!: string  // e.g., 'sync_medusa_products'

  @Property()
  entityType!: string  // e.g., 'catalog.product'

  @Property({ length: 20 })
  direction!: 'import' | 'export'

  @Property({ default: false })
  isEnabled!: boolean

  /** Cron expression for scheduling (e.g., '0 */6 * * *' for every 6 hours) */
  @Property({ length: 100 })
  cronExpression!: string

  /** Human-readable label (e.g., 'Every 6 hours', 'Daily at 2am') */
  @Property({ nullable: true })
  label?: string

  /** Whether to run a full sync or delta sync */
  @Property({ default: false })
  fullSync!: boolean

  @Property({ nullable: true })
  lastRunAt?: Date

  @Property({ nullable: true })
  nextRunAt?: Date

  @Property()
  organizationId!: string

  @Property()
  tenantId!: string

  @Unique({ properties: ['integrationId', 'entityType', 'direction', 'organizationId', 'tenantId'] })
  _unique!: never
}
```

#### Scheduler Widget UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  ── Sync Schedule ──────────────────────────────────────────────── │
│                                                                     │
│  Import Products                              [Enabled ●]           │
│                                                                     │
│  Frequency: [Every 6 hours ▾]                                      │
│                                                                     │
│  Presets:                                                           │
│  ( ) Every 15 minutes    ( ) Every hour    (●) Every 6 hours       │
│  ( ) Every 12 hours      ( ) Daily at 2am  ( ) Custom cron         │
│                                                                     │
│  Custom cron: [0 */6 * * *                  ]                       │
│                                                                     │
│  Sync mode:                                                         │
│  (●) Delta sync — only changes since last run                      │
│  ( ) Full sync — reimport everything                                │
│                                                                     │
│  Last run: 2 hours ago (12,340 items, 0 failures)                  │
│  Next run: in 4 hours                                               │
│                                                                     │
│  [Run Now]                                            [Save]        │
└─────────────────────────────────────────────────────────────────────┘
```

#### Injection Table — Hub Level

The scheduler widget is injected by the `data_sync` **hub** module, so it appears on every data sync integration's detail page automatically:

```typescript
// data_sync/widgets/injection-table.ts

export const injectionTable: ModuleInjectionTable = {
  'integrations.detail.data_sync:tabs': [
    {
      widgetId: 'data_sync.injection.scheduler',
      kind: 'tab',
      groupLabel: 'data_sync.tabs.scheduler',
      priority: 80,
    },
  ],
}
```

#### Scheduler Worker

A scheduled worker runs every minute, checks which `SyncSchedule` entries are due, and enqueues sync jobs:

```typescript
// data_sync/workers/sync-scheduler.ts

export const metadata: WorkerMeta = {
  queue: 'data-sync-scheduler',
  id: 'data-sync-scheduler',
  concurrency: 1,
  schedule: '* * * * *',  // Every minute
}

export default async function handler(job: Job, ctx: WorkerContext) {
  const now = new Date()
  const dueSchedules = await ctx.em.find(SyncSchedule, {
    isEnabled: true,
    nextRunAt: { $lte: now },
  })

  for (const schedule of dueSchedules) {
    // Create a SyncRun + enqueue to the import/export worker
    const syncRun = await createSyncRun({
      integrationId: schedule.integrationId,
      entityType: schedule.entityType,
      direction: schedule.direction,
      triggeredBy: 'scheduler',
      cursor: schedule.fullSync ? undefined : await getLastCursor(schedule, ctx.em),
      organizationId: schedule.organizationId,
      tenantId: schedule.tenantId,
    }, ctx)

    await ctx.enqueueJob(`data-sync-${schedule.direction}`, {
      syncRunId: syncRun.id,
      organizationId: schedule.organizationId,
    })

    // Update schedule — calculate next run from cron
    schedule.lastRunAt = now
    schedule.nextRunAt = getNextCronDate(schedule.cronExpression, now)
  }

  await ctx.em.flush()
}
```

#### Scheduler API

```
GET  /api/data-sync/schedules?integrationId=sync_medusa_products
POST /api/data-sync/schedules                     # Create/update schedule
PUT  /api/data-sync/schedules/:id                 # Update schedule
DELETE /api/data-sync/schedules/:id               # Remove schedule
POST /api/data-sync/schedules/:id/run-now         # Trigger immediate sync
```

### 6.2 Mapping Configuration Widget

Each data sync **provider** module injects its own mapping configuration widget. The mapping widget is provider-specific because different sources have different schemas and field discovery mechanisms.

```typescript
// sync_medusa/widgets/injection-table.ts

export const injectionTable: ModuleInjectionTable = {
  'integrations.detail:tabs': [
    {
      widgetId: 'sync_medusa.injection.mapping-config',
      kind: 'tab',
      groupLabel: 'integrations.tabs.settings',
      priority: 100,
    },
  ],
}
```

The mapping widget reads the adapter's default mapping via `GET /api/data-sync/mappings?integrationId=...`, lets the admin customize it, and saves via `PUT /api/data-sync/mappings/:id`. The `SyncMapping` entity (§4.4) stores the customized mapping.

---

## 7. Reference Implementation 2 — `sync_excel` (File Upload)

The MedusaJS bundle demonstrates API-based sync. The `sync_excel` module is a **zero-dependency example** that demonstrates **file-upload-based sync** — admin uploads an Excel/CSV file, configures column mapping, and imports data. No external API keys required, making it ideal for testing and demos.

### 7.1 How It Works

```
Admin uploads file → Preview rows → Configure mapping → Start import
     ▲                                                       │
     │                                                       ▼
     │                                          Queue worker processes
     │                                          rows via DataSyncAdapter
     │                                          with ProgressService
     │                                                       │
     └───────────────────────────────────────────────────────┘
                        View progress in ProgressTopBar
```

### 7.2 Module Structure

```
packages/core/src/modules/sync_excel/
├── index.ts
├── integration.ts                    # Single integration, no bundle needed
├── setup.ts                          # Register adapter
├── di.ts
├── lib/
│   ├── adapters/
│   │   ├── products.ts               # DataSyncAdapter for products
│   │   └── customers.ts              # DataSyncAdapter for customers
│   ├── parser.ts                     # Excel/CSV file parser (xlsx + csv)
│   ├── column-detector.ts            # Auto-detect column → field mapping
│   └── health.ts                     # Always healthy (no external API)
├── data/
│   ├── entities.ts                   # ExcelUpload (tracks uploaded files)
│   └── validators.ts
├── api/
│   ├── post/sync-excel/upload.ts     # Upload file + store temporarily
│   ├── get/sync-excel/preview.ts     # Preview first N rows + detected columns
│   ├── post/sync-excel/import.ts     # Start import from uploaded file
│   └── get/sync-excel/templates.ts   # Download template files
├── widgets/
│   ├── injection-table.ts
│   └── injection/
│       └── upload-config/
│           ├── widget.ts             # Widget metadata + event handlers
│           └── widget.client.tsx     # File upload + mapping UI
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 7.3 Integration Definition

```typescript
// sync_excel/integration.ts

export const integration: IntegrationDefinition = {
  id: 'sync_excel',
  title: 'Excel / CSV Import',
  description: 'Import products, customers, and other data from Excel (.xlsx) or CSV files.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: 'excel',
  icon: 'file-spreadsheet',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  tags: ['excel', 'csv', 'file-upload', 'import', 'spreadsheet'],
  credentials: { fields: [] },  // No credentials needed — file upload only
}
```

### 7.4 File Upload API

```typescript
// sync_excel/api/post/sync-excel/upload.ts

/** Accept multipart/form-data with a single file */
export const openApi = {
  summary: 'Upload Excel or CSV file for import',
  tags: ['Data Sync', 'Excel'],
  requestBody: { content: { 'multipart/form-data': { /* file field */ } } },
}

export default async function handler(req: ApiRequest) {
  const file = await parseMultipartFile(req, {
    maxSize: 50 * 1024 * 1024,  // 50MB limit
    allowedTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // .xlsx
      'text/csv',  // .csv
      'application/vnd.ms-excel',  // .xls (legacy)
    ],
  })

  // Store file temporarily (local storage, cleaned up after 24h)
  const upload = await storeTemporaryUpload(file, ctx)

  // Parse headers and first 5 rows for preview
  const preview = await parsePreview(file, { maxRows: 5 })

  return Response.json({
    uploadId: upload.id,
    filename: file.name,
    fileSize: file.size,
    sheetNames: preview.sheetNames,
    columns: preview.columns,        // Detected column names
    sampleRows: preview.sampleRows,  // First 5 rows
    totalRows: preview.totalRows,    // Estimated row count
    detectedMapping: preview.detectedMapping,  // Auto-detected field mapping
  })
}
```

### 7.5 Mapping Configuration Widget

The `sync_excel` module injects a configuration widget with a file upload UI + column mapping editor:

```typescript
// sync_excel/widgets/injection-table.ts

export const injectionTable: ModuleInjectionTable = {
  'integrations.detail:tabs': [
    {
      widgetId: 'sync_excel.injection.upload-config',
      kind: 'tab',
      groupLabel: 'sync_excel.tabs.import',
      priority: 100,
    },
  ],
}
```

#### Upload & Mapping Widget UI

```
┌─────────────────────────────────────────────────────────────────────┐
│  ── Import from Excel / CSV ───────────────────────────────────── │
│                                                                     │
│  Entity: [Products ▾]                                               │
│                                                                     │
│  ┌─ Step 1: Upload File ──────────────────────────────────────┐    │
│  │                                                             │    │
│  │  [📄 Drop file here or click to browse]                    │    │
│  │                                                             │    │
│  │  Accepted: .xlsx, .csv (max 50MB)                          │    │
│  │  [Download Template: Products.xlsx]                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─ Step 2: Configure Mapping ────────────────────────────────┐    │
│  │  File: products-2026.xlsx (Sheet 1, 1,234 rows)            │    │
│  │                                                             │    │
│  │  Excel Column        →    Local Field       Transform      │    │
│  │  ─────────────────────────────────────────────────────────  │    │
│  │  "Product Name"      →    [Title ▾]         [— none — ▾]  │    │
│  │  "SKU"               →    [SKU ▾]           [— none — ▾]  │    │
│  │  "Price"             →    [Base Price ▾]    [— none — ▾]  │    │
│  │  "Description"       →    [Description ▾]   [— none — ▾]  │    │
│  │  "Category"          →    [— skip — ▾]      [— none — ▾]  │    │
│  │  "Image URL"         →    [Image URL ▾]     [— none — ▾]  │    │
│  │                                                             │    │
│  │  Match existing by: (●) SKU  ( ) External ID  ( ) Name    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─ Step 3: Preview ──────────────────────────────────────────┐    │
│  │  │ Title       │ SKU    │ Price  │ Description │ Action   │    │
│  │  ├─────────────┼────────┼────────┼─────────────┼──────────│    │
│  │  │ Widget Pro  │ WP-001 │ 29.99  │ A nice...   │ Create   │    │
│  │  │ Gadget Max  │ GM-002 │ 49.99  │ Best...     │ Update   │    │
│  │  │ Thingamajig │ TM-003 │ 9.99   │ Small...    │ Create   │    │
│  │  Showing 3 of 1,234 rows                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│                                              [Start Import]         │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.6 DataSyncAdapter — File-Based Import

```typescript
// sync_excel/lib/adapters/products.ts

export const excelProductsAdapter: DataSyncAdapter = {
  providerKey: 'excel_products',
  direction: 'import',
  supportedEntities: ['catalog.product'],

  async *streamImport(input: StreamImportInput): AsyncIterable<ImportBatch> {
    // The file is referenced via input.credentials.uploadId
    const uploadId = input.credentials.uploadId as string
    const parser = await openFileParser(uploadId)
    let batchIndex = 0
    let rowOffset = 0

    // Resume from cursor (row number)
    if (input.cursor) {
      rowOffset = parseInt(input.cursor, 10)
      await parser.skipRows(rowOffset)
    }

    while (parser.hasMore()) {
      const rows = await parser.readBatch(input.batchSize)

      const items: ImportItem[] = rows.map(row => ({
        externalId: row[input.mapping.matchField ?? 'sku'] ?? `row-${rowOffset + rows.indexOf(row)}`,
        data: row,
        action: 'create',  // Determined later by entity writer using match strategy
        hash: computeRowHash(row),
      }))

      rowOffset += rows.length

      yield {
        items,
        cursor: String(rowOffset),
        hasMore: parser.hasMore(),
        totalEstimate: parser.totalRows,
        batchIndex: batchIndex++,
      }
    }
  },

  async getMapping(): Promise<DataMapping> {
    return {
      entityType: 'catalog.product',
      matchStrategy: 'sku',
      matchField: 'sku',
      fields: [
        { externalField: 'Product Name', localField: 'title' },
        { externalField: 'SKU', localField: 'sku' },
        { externalField: 'Price', localField: 'basePrice' },
        { externalField: 'Description', localField: 'description' },
        { externalField: 'Image URL', localField: 'imageUrl' },
      ],
    }
  },

  async validateConnection(): Promise<ValidationResult> {
    return { valid: true, message: 'File upload — no connection needed.' }
  },
}
```

### 7.7 Column Auto-Detection

The parser detects column names from the first row and suggests mappings using fuzzy matching:

```typescript
// sync_excel/lib/column-detector.ts

const FIELD_ALIASES: Record<string, string[]> = {
  title: ['product name', 'name', 'title', 'product title', 'item name'],
  sku: ['sku', 'product code', 'code', 'article number', 'item number'],
  basePrice: ['price', 'unit price', 'base price', 'retail price', 'cost'],
  description: ['description', 'product description', 'details', 'info'],
  imageUrl: ['image', 'image url', 'photo', 'picture', 'thumbnail'],
  isActive: ['active', 'status', 'enabled', 'published', 'visible'],
}

export function detectMapping(columns: string[], entityType: string): FieldMapping[] {
  return columns.map(col => {
    const normalized = col.toLowerCase().trim()
    for (const [localField, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(normalized)) {
        return { externalField: col, localField }
      }
    }
    return { externalField: col, localField: '' }  // Unmapped — admin configures
  })
}
```

### 7.8 Template Downloads

Admin can download a pre-formatted template file for the entity type they want to import:

```
GET /api/sync-excel/templates?entityType=catalog.product

→ 200: Excel file with correct column headers and 3 example rows
```

### 7.9 Integration Tests (sync_excel)

| Test | Method | Assert |
|------|--------|--------|
| Upload valid Excel file | POST `/api/sync-excel/upload` | Returns uploadId, columns, sample rows, detected mapping |
| Upload valid CSV file | POST `/api/sync-excel/upload` | Same as Excel — parser handles both |
| Reject oversized file | POST `/api/sync-excel/upload` (60MB) | 413 error |
| Reject invalid file type | POST `/api/sync-excel/upload` (.pdf) | 422 error |
| Preview with auto-detected mapping | GET `/api/sync-excel/preview?uploadId=...` | Columns matched to local fields |
| Import from uploaded file | POST `/api/sync-excel/import` | SyncRun created, items imported, ProgressJob tracks progress |
| Resume after failure | Import with cursor | Skips already-processed rows |
| Download template | GET `/api/sync-excel/templates?entityType=catalog.product` | Returns .xlsx with correct headers |
| Column detection | Service | Known column names mapped to correct local fields |
| Scheduler creates Excel sync run | Worker | Schedule with `integrationId: sync_excel` triggers import |

---

## 8. Performance Considerations

### 8.1 Batch Size Tuning

| Entity Type | Default Batch | Rationale |
|-------------|--------------|-----------|
| Products | 100 | Moderate payload size, variants expand data |
| Customers | 200 | Smaller payloads per record |
| Orders | 50 | Large payloads with line items, payments |
| Inventory | 500 | Tiny payloads (warehouse + qty) |

### 8.2 Concurrency Control

```typescript
// Worker concurrency settings
export const metadata: WorkerMeta = {
  queue: 'data-sync-import',
  concurrency: 3,  // Max 3 parallel import runs
}
```

- Import worker concurrency = 3 (bounded by external API rate limits)
- Export worker concurrency = 2 (bounded by external API write limits)
- Entity writer uses `em.transactional()` per batch — not per item
- Batches are flushed to DB in a single transaction (all-or-nothing per batch)

### 8.3 Memory Efficiency

The async iterable pattern ensures only **one batch is in memory at a time**:

```
External API  →  [Batch 1]  →  process  →  flush to DB  →  GC  →  [Batch 2]  →  ...
                  ↑ only this is in memory at any time
```

### 8.4 Rate Limiting

The adapter is responsible for respecting external API rate limits. The hub provides a utility:

```typescript
// data_sync/lib/rate-limiter.ts
export function createRateLimiter(requestsPerSecond: number) {
  // Token bucket implementation
  // Used by adapter clients to throttle outbound requests
}
```

---

## 9. Integration Test Coverage

| Test | Method | Assert |
|------|--------|--------|
| Start import sync run | POST `/api/data-sync/run` | Creates SyncRun in `pending`, enqueues job |
| Import worker processes mock adapter | Worker | Items created/updated, cursor persisted, progress updated |
| ProgressJob created on sync start | Worker | `ProgressJob` created with `jobType: 'data_sync:import'`, linked via `syncRun.progressJobId` |
| ProgressJob updated per batch | Worker | `progressService.updateProgress()` called after each batch; `processedCount`, `progressPercent`, `etaSeconds` reflect batch progress |
| ProgressJob completed on sync finish | Worker | `progressService.completeJob()` called with `resultSummary` containing action counts |
| ProgressJob failed on sync error | Worker | `progressService.failJob()` called with error details |
| Cancel via ProgressService | ProgressTopBar cancel / DELETE `/api/progress/jobs/:id` | `progressService.isCancellationRequested()` returns true → sync stops at next batch boundary, SyncRun status → `cancelled` |
| Active sync visible in ProgressTopBar | GET `/api/progress/active` | Running sync shows in active jobs list with correct `jobType`, progress, ETA |
| Resume after failure | POST `.../retry` | New SyncRun + new ProgressJob start from last cursor, not from zero |
| Full re-sync | POST `/api/data-sync/run` with `fullSync: true` | Cursor reset, processes all items |
| Sync run detail includes ProgressJob | GET `.../runs/:id` | Response includes linked `progressJob` data (percent, ETA, status) |
| Item-level errors logged | Worker with failing items | Errors in `IntegrationLog`, `failedCount` incremented, sync continues |
| Batch cursor persistence | Worker with 5 batches | After each batch, `SyncCursor` updated |
| Delta detection | Import with cursor | Only items after cursor are processed |
| Bundle credential resolution | Adapter in bundle module | Credentials resolved from bundle, not from individual integration |
| Export streaming | Export worker | Items streamed to mock external API, results logged |
| Validate connection | POST `/api/data-sync/validate` | Returns connection validation result |
| Save custom mapping | PUT `/api/data-sync/mappings/:id` | SyncMapping persisted, used by subsequent sync runs |
| External ID mapping store + lookup | Service | `storeExternalIdMapping` → `lookupLocalId` / `lookupExternalId` roundtrip |
| Loop prevention via origin tagging | Subscriber + Worker | Inbound webhook sets `_syncOrigin`, outbound subscriber skips matching origin |
| Create sync schedule | POST `/api/data-sync/schedules` | Schedule created with cron expression, `nextRunAt` calculated |
| Scheduler worker fires due sync | Worker | SyncRun created + enqueued when `nextRunAt <= now`, `nextRunAt` updated |
| Scheduler delta sync uses last cursor | Worker | Scheduled sync reads last `SyncCursor` for delta, not full sync |
| Scheduler full sync ignores cursor | Worker | Schedule with `fullSync: true` starts from zero |
| Disable schedule | PUT `/api/data-sync/schedules/:id` with `isEnabled: false` | Scheduler worker skips disabled schedules |
| Run Now from schedule | POST `/api/data-sync/schedules/:id/run-now` | Immediate SyncRun created, schedule `lastRunAt` updated |
