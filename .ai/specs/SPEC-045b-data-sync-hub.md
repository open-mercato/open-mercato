# SPEC-045b — Data Sync Hub: Import/Export with Delta Streaming

**Parent**: [SPEC-045 — Integration Marketplace](./SPEC-045-2026-02-24-integration-marketplace.md)
**Phase**: 2 of 6

---

## Goal

Build the `data_sync` hub module with a `DataSyncAdapter` contract designed for **high-velocity, delta-based, resumable import/export** using streaming, queue-based processing, and real-time progress tracking. Then build the first provider bundle (`sync_medusa`) as a reference implementation.

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
| 5 | **Progress observable** — real-time progress via polling API + notification on completion | Admin sees progress bar, ETA, item counts |
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
├── di.ts                        # Sync service, adapter registry
├── events.ts                    # Sync lifecycle events
├── setup.ts
├── lib/
│   ├── adapter.ts               # DataSyncAdapter interface + types
│   ├── adapter-registry.ts      # registerDataSyncAdapter / getAdapter
│   ├── sync-engine.ts           # Orchestrates streaming, batching, cursor persistence
│   ├── sync-run-service.ts      # CRUD for SyncRun entity
│   ├── transforms.ts            # Built-in field transforms
│   └── entity-writer.ts         # Generic entity upsert using mapping
├── data/
│   ├── entities.ts              # SyncRun, SyncCursor, SyncMapping
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
│   └── sync-export.ts           # Export worker — drives streamExport
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

Tracks each sync execution with real-time progress:

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

  /** Progress counters — updated after each batch */
  @Property({ default: 0 })
  processedCount!: number

  @Property({ default: 0 })
  createdCount!: number

  @Property({ default: 0 })
  updatedCount!: number

  @Property({ default: 0 })
  skippedCount!: number

  @Property({ default: 0 })
  failedCount!: number

  @Property({ nullable: true })
  totalEstimate?: number  // Estimated total (from adapter), null if unknown

  @Property({ default: 0 })
  batchesCompleted!: number

  /** Timing */
  @Property({ nullable: true })
  startedAt?: Date

  @Property({ nullable: true })
  completedAt?: Date

  /** Error summary (last error message for UI display) */
  @Property({ type: 'text', nullable: true })
  lastError?: string

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

### 4.4 Sync Engine — Streaming Orchestration

The sync engine is the heart of the hub. It drives the adapter's async iterable, persists cursors, updates progress, and logs every step.

```typescript
// data_sync/lib/sync-engine.ts

export function createSyncEngine({ em, integrationLog, eventBus }: Dependencies) {
  return {
    async runImport(syncRun: SyncRun, adapter: DataSyncAdapter, input: StreamImportInput): Promise<void> {
      const log = integrationLog.scoped(syncRun.integrationId, syncRun.id, {
        organizationId: syncRun.organizationId,
        tenantId: syncRun.tenantId,
      })

      syncRun.status = 'running'
      syncRun.startedAt = new Date()
      await em.flush()

      await log.info('sync.import.started', `Starting ${input.entityType} import`, {
        cursor: input.cursor ?? 'full-sync',
        batchSize: input.batchSize,
      })

      try {
        for await (const batch of adapter.streamImport!(input)) {
          // Check if sync was cancelled
          await em.refresh(syncRun)
          if (syncRun.status === 'cancelled') {
            await log.info('sync.import.cancelled', 'Sync cancelled by user')
            return
          }

          // Process each item in the batch
          for (const item of batch.items) {
            try {
              await processImportItem(item, input, em)

              if (item.action === 'create') syncRun.createdCount++
              else if (item.action === 'update') syncRun.updatedCount++
              else syncRun.skippedCount++

              syncRun.processedCount++
            } catch (err) {
              syncRun.failedCount++
              syncRun.processedCount++
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
          if (batch.totalEstimate) syncRun.totalEstimate = batch.totalEstimate
          await em.flush()

          // Update the global cursor for next delta run
          await persistSyncCursor(syncRun.integrationId, input.entityType, 'import', batch.cursor, em)

          await log.info('sync.import.batch', `Batch ${batch.batchIndex + 1}: +${batch.items.length} items`, {
            batchIndex: batch.batchIndex,
            processedCount: syncRun.processedCount,
            createdCount: syncRun.createdCount,
            updatedCount: syncRun.updatedCount,
            failedCount: syncRun.failedCount,
            cursor: batch.cursor,
          })

          if (!batch.hasMore) break
        }

        syncRun.status = 'completed'
        syncRun.completedAt = new Date()
        await em.flush()

        const durationMs = syncRun.completedAt.getTime() - syncRun.startedAt!.getTime()
        await log.info('sync.import.completed', `Import complete: ${syncRun.createdCount} created, ${syncRun.updatedCount} updated, ${syncRun.failedCount} failed`, {
          createdCount: syncRun.createdCount,
          updatedCount: syncRun.updatedCount,
          skippedCount: syncRun.skippedCount,
          failedCount: syncRun.failedCount,
          durationMs,
        })

        await eventBus.emit('data_sync.run.completed', { syncRunId: syncRun.id })

      } catch (err) {
        syncRun.status = 'failed'
        syncRun.lastError = err.message
        syncRun.completedAt = new Date()
        await em.flush()

        await log.error('sync.import.failed', `Import failed: ${err.message}`, {
          error: err.message,
          stack: err.stack,
          processedBeforeFailure: syncRun.processedCount,
          lastCursor: syncRun.cursor,
        })

        await eventBus.emit('data_sync.run.failed', { syncRunId: syncRun.id, error: err.message })
      }
    },
  }
}
```

### 4.5 Import Worker

```typescript
// data_sync/workers/sync-import.ts

export const metadata: WorkerMeta = {
  queue: 'data-sync-import',
  id: 'data-sync-import-worker',
  concurrency: 3,  // Max 3 parallel syncs (I/O-bound, external API rate limits)
}

export default async function handler(job: Job, ctx: WorkerContext) {
  const { syncRunId } = job.data

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

### 4.6 Progress API

```
GET /api/data-sync/runs/abc123

→ 200: {
  id: 'abc123',
  integrationId: 'sync_medusa_products',
  entityType: 'catalog.product',
  direction: 'import',
  status: 'running',
  processedCount: 34500,
  createdCount: 12000,
  updatedCount: 22400,
  skippedCount: 0,
  failedCount: 100,
  totalEstimate: 50000,
  batchesCompleted: 345,
  startedAt: '2026-02-24T14:00:00Z',
  elapsedMs: 120000,
  estimatedRemainingMs: 52000,  // calculated from rate
  itemsPerSecond: 287,          // calculated from elapsed
  lastError: 'Invalid SKU format for product xyz-123',
}
```

### 4.7 Progress UI — Sync Run Detail Page

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Data Sync Runs                                                   │
│                                                                     │
│  MedusaJS — Products                              Status: Running  │
│  Import • Started 2 min ago by admin@example.com                   │
│                                                                     │
│  ── Progress ─────────────────────────────────────────────────────  │
│  [████████████████████░░░░░░░░] 69%   34,500 / ~50,000            │
│  287 items/sec • ~52s remaining                                    │
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

### 4.8 Retry & Resume

**Resume after failure**: When a sync run fails mid-way (e.g., network error at batch 345), the `cursor` is already persisted at batch 344. Clicking "Retry" creates a new `SyncRun` with `initialCursor = syncRun.cursor`, so it picks up where it left off.

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

### 4.9 Events

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

### 5.1 Module Structure

```
packages/core/src/modules/sync_medusa/
├── index.ts                    # Module metadata
├── integration.ts              # Bundle + 5 integration definitions (§1.2 in SPEC-045a)
├── setup.ts                    # Register all adapters
├── di.ts                       # Health check service
├── lib/
│   ├── client.ts               # MedusaJS REST client (streaming-capable)
│   ├── adapters/
│   │   ├── products.ts         # DataSyncAdapter for products
│   │   ├── customers.ts        # DataSyncAdapter for customers
│   │   ├── orders.ts           # DataSyncAdapter for orders
│   │   └── inventory.ts        # DataSyncAdapter for inventory
│   ├── transforms.ts           # Medusa-specific field transforms
│   └── health.ts               # HealthCheckable implementation
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 5.2 Streaming MedusaJS Client

The client uses cursor-based pagination from MedusaJS's API to stream data without loading everything into memory:

```typescript
// sync_medusa/lib/client.ts

export function createMedusaClient(credentials: Record<string, unknown>) {
  const baseUrl = credentials.medusaApiUrl as string
  const apiKey = credentials.medusaApiKey as string

  return {
    async *streamProducts(cursor?: string, batchSize = 100): AsyncIterable<{
      items: MedusaProduct[]
      nextCursor: string | null
      totalCount: number
    }> {
      let offset = cursor ? parseInt(cursor, 10) : 0

      while (true) {
        const response = await fetch(
          `${baseUrl}/admin/products?offset=${offset}&limit=${batchSize}&order=updated_at`,
          { headers: { 'x-medusa-access-token': apiKey } },
        )

        if (!response.ok) {
          throw new Error(`MedusaJS API error: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        const products = data.products as MedusaProduct[]

        yield {
          items: products,
          nextCursor: products.length === batchSize ? String(offset + batchSize) : null,
          totalCount: data.count,
        }

        if (products.length < batchSize) break
        offset += batchSize
      }
    },

    // Similar for customers, orders, inventory...
  }
}
```

### 5.3 Products Adapter Implementation

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
        action: determineAction(product, input),  // 'create' | 'update' | 'skip'
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
    // Stream local products, push to Medusa API
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
        { externalField: 'metadata.categories', localField: 'categoryIds', transform: 'medusaCategoryMap' },
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

### 5.4 Delta Detection

The adapter determines whether each item is a create, update, or skip:

```typescript
function determineAction(
  externalProduct: MedusaProduct,
  input: StreamImportInput,
): 'create' | 'update' | 'skip' {
  // Option 1: Hash-based change detection
  // Store hash of each imported item in SyncItemHash table
  // Compare current hash with stored hash
  // Same hash → skip, different hash → update, no stored hash → create

  // Option 2: Timestamp-based (preferred for delta cursors)
  // The cursor is a timestamp — only items updated after cursor are streamed
  // If cursor is set, all items in the stream are 'update' or 'create'
  // Check if local entity with matching externalId exists → update, else → create
}
```

For MedusaJS specifically, delta detection works via `updated_at` ordering:
1. First sync: cursor = null, all items are `create`
2. Subsequent syncs: cursor = timestamp of last sync, MedusaJS API filters by `updated_at > cursor`
3. For each item, check if a local product with matching external ID exists → `update` if yes, `create` if no

### 5.5 Setup — Registration

```typescript
// sync_medusa/setup.ts

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['data_sync.*'],
    admin: ['data_sync.view', 'data_sync.run'],
  },

  async onTenantCreated() {
    registerDataSyncAdapter(medusaProductsAdapter)
    registerDataSyncAdapter(medusaCustomersAdapter)
    registerDataSyncAdapter(medusaOrdersAdapter)
    registerDataSyncAdapter(medusaInventoryAdapter)
  },
}
```

---

## 6. Performance Considerations

### 6.1 Batch Size Tuning

| Entity Type | Default Batch | Rationale |
|-------------|--------------|-----------|
| Products | 100 | Moderate payload size, variants expand data |
| Customers | 200 | Smaller payloads per record |
| Orders | 50 | Large payloads with line items, payments |
| Inventory | 500 | Tiny payloads (warehouse + qty) |

### 6.2 Concurrency Control

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

### 6.3 Memory Efficiency

The async iterable pattern ensures only **one batch is in memory at a time**:

```
External API  →  [Batch 1]  →  process  →  flush to DB  →  GC  →  [Batch 2]  →  ...
                  ↑ only this is in memory at any time
```

### 6.4 Rate Limiting

The adapter is responsible for respecting external API rate limits. The hub provides a utility:

```typescript
// data_sync/lib/rate-limiter.ts
export function createRateLimiter(requestsPerSecond: number) {
  // Token bucket implementation
  // Used by adapter clients to throttle outbound requests
}
```

---

## 7. Integration Test Coverage

| Test | Method | Assert |
|------|--------|--------|
| Start import sync run | POST `/api/data-sync/run` | Creates SyncRun in `pending`, enqueues job |
| Import worker processes mock adapter | Worker | Items created/updated, cursor persisted, progress updated |
| Resume after failure | POST `.../retry` | New run starts from last cursor, not from zero |
| Cancel running sync | POST `.../cancel` | Status → cancelled, worker stops at next batch boundary |
| Full re-sync | POST `/api/data-sync/run` with `fullSync: true` | Cursor reset, processes all items |
| Progress API during sync | GET `.../runs/:id` | Returns current counts + rate + ETA |
| Item-level errors logged | Worker with failing items | Errors in `IntegrationLog`, `failedCount` incremented, sync continues |
| Batch cursor persistence | Worker with 5 batches | After each batch, `SyncCursor` updated |
| Delta detection | Import with cursor | Only items after cursor are processed |
| Bundle credential resolution | Adapter in bundle module | Credentials resolved from bundle, not from individual integration |
| Export streaming | Export worker | Items streamed to mock external API, results logged |
| Validate connection | POST `/api/data-sync/validate` | Returns connection validation result |
