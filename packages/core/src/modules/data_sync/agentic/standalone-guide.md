# Data Sync Module — Standalone App Guide

The data sync module provides a streaming synchronization hub for import/export operations with external systems. Provider modules register `DataSyncAdapter` implementations.

## Creating a Sync Adapter

Implement the `DataSyncAdapter` interface in your provider module:

```typescript
import type { DataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter'

const myAdapter: DataSyncAdapter = {
  providerKey: 'my_provider',
  direction: 'import',  // 'import' | 'export' | 'bidirectional'
  supportedEntities: ['catalog.product', 'customers.person'],

  async *streamImport(entityType, cursor, config) {
    // Yield ImportBatch objects with records
    yield { records: [...], cursor: 'next-page-token' }
  },

  async validateConnection(credentials) {
    // Verify external system is reachable
    return { valid: true }
  },

  async getInitialCursor(entityType) {
    return null  // Start from beginning
  },
}
```

Register in your module's `di.ts`:
```typescript
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
registerDataSyncAdapter(myAdapter)
```

## Run Lifecycle

```
pending → running → completed | failed | cancelled
```

- **Cursor persistence**: After each batch, cursor is saved — enables resume on failure
- **Progress**: Linked to `ProgressJob` for live progress display via `ProgressTopBar`
- **Cancellation**: Via `progressService.isCancellationRequested()`
- **Overlap protection**: Only one sync per integration + entityType + direction at a time

## Key Services (DI)

| Service | Purpose |
|---------|---------|
| `dataSyncRunService` | CRUD for sync runs, cursor management, overlap detection |
| `dataSyncEngine` | Orchestrates streaming import/export with batch processing and progress |
| `externalIdMappingService` | Maps local entity IDs to/from external system IDs |

## Starting a Sync

Via API:
```
POST /api/data_sync/run
{ "integrationId": "my_provider", "entityType": "catalog.product", "direction": "import" }
```

Syncs run asynchronously via the queue system — never run inline in API handlers.

## Queue Workers

| Queue | Worker | Concurrency |
|-------|--------|-------------|
| `data-sync-import` | Import handler | 5 |
| `data-sync-export` | Export handler | 5 |
| `data-sync-scheduled` | Scheduled sync dispatch | 3 |

## Events

| Event | When |
|-------|------|
| `data_sync.run.started` | Sync begins processing |
| `data_sync.run.completed` | Sync finishes successfully |
| `data_sync.run.failed` | Sync fails |
| `data_sync.run.cancelled` | Sync is cancelled |

Subscribe to these events to trigger post-sync side effects in your module.

## UMES Extension Points

Sync providers can extend the platform UI:

| Extension | Use Case |
|-----------|----------|
| **Widget Injection** | Sync status badges, mapping previews on entity pages |
| **Event Subscribers** | React to sync lifecycle events |
| **Entity Extensions** | Link sync metadata to core entities |
| **Response Enrichers** | Attach external ID data to API responses |
| **Notifications** | Alerts on sync completion/failure |
| **DOM Event Bridge** | Real-time sync progress via SSE |
| **Menu Injection** | Provider-specific sync dashboards in sidebar |

## Key Rules

- Always scope queries by `organizationId` + `tenantId`
- Use the queue system — never run syncs inline
- Persist cursor after each batch — enables resume on failure
- Log item-level errors — don't stop the sync for individual failures
- Check for overlap before starting a new run
