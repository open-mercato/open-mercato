# Search Module

The search module provides unified search capabilities across all entities in Open Mercato, supporting multiple search strategies including Meilisearch (full-text) and vector embeddings (semantic search).

## Features

- **Multi-strategy search**: Combines Meilisearch full-text search with vector-based semantic search
- **Automatic indexing**: Subscribes to entity events for real-time index updates
- **Queue-based processing**: Supports async batch processing via Redis/BullMQ for high-volume indexing
- **Configurable embeddings**: Supports OpenAI, Ollama, and other embedding providers
- **Tenant-scoped**: All indexes are scoped by tenant and optionally by organization

## Programmatic Integration (DI)

Other modules can use the search functionality by resolving services from the DI container.

### SearchService

The primary service for executing searches and managing indexes:

```typescript
import type { SearchService } from '@open-mercato/search'

// Resolve from DI container
const searchService = container.resolve('searchService') as SearchService

// Execute a search
const results = await searchService.search('john doe', {
  tenantId: 'tenant-123',
  organizationId: 'org-456', // optional
  limit: 20,
  strategies: ['meilisearch', 'vector'], // optional - defaults to all available
})

// Index a record
await searchService.index({
  entityId: 'customers:customer_person_profile',
  recordId: 'rec-123',
  tenantId: 'tenant-123',
  organizationId: 'org-456',
  fields: { name: 'John Doe', email: 'john@example.com' },
  presenter: { title: 'John Doe', subtitle: 'Customer' },
  url: '/backend/customers/people/rec-123',
})

// Bulk index multiple records
await searchService.bulkIndex([record1, record2, record3])

// Delete from all indexes
await searchService.delete('customers:customer_person_profile', 'rec-123', 'tenant-123')

// Purge all records for an entity type
await searchService.purge('customers:customer_person_profile', 'tenant-123')

// Check strategy availability
const isAvailable = await searchService.isStrategyAvailable('meilisearch')
```

### SearchIndexer (Higher-Level API)

For config-aware indexing with automatic presenter/URL resolution:

```typescript
import type { SearchIndexer } from '@open-mercato/search'

const searchIndexer = container.resolve('searchIndexer') as SearchIndexer

// Index with automatic config-based formatting
await searchIndexer.indexRecord({
  entityId: 'customers:customer_person_profile',
  recordId: 'rec-123',
  tenantId: 'tenant-123',
  organizationId: 'org-456',
  record: { id: 'rec-123', name: 'John Doe', email: 'john@example.com' },
  customFields: { priority: 'high' },
})

// Check if entity is enabled for search
if (searchIndexer.isEntityEnabled('customers:customer_person_profile')) {
  // Entity is configured for indexing
}

// List all search-enabled entities
const entities = searchIndexer.listEnabledEntities()

// Reindex to Meilisearch with queue support
const result = await searchIndexer.reindexEntityToMeilisearch({
  entityId: 'customers:customer_person_profile',
  tenantId: 'tenant-123',
  organizationId: 'org-456',
  recreateIndex: true,
  useQueue: true, // Use async queue if available
})
```

### SearchService Methods

| Method | Description |
|--------|-------------|
| `search(query, options)` | Execute search across strategies |
| `index(record)` | Index a single record |
| `bulkIndex(records)` | Bulk index multiple records |
| `delete(entityId, recordId, tenantId)` | Delete from all strategies |
| `purge(entityId, tenantId)` | Purge all records for entity type |
| `registerStrategy(strategy)` | Add custom strategy at runtime |
| `unregisterStrategy(strategyId)` | Remove a strategy |
| `getRegisteredStrategies()` | List registered strategy IDs |
| `getStrategy(strategyId)` | Get specific strategy instance |
| `isStrategyAvailable(strategyId)` | Check strategy availability |

### SearchIndexer Methods

| Method | Description |
|--------|-------------|
| `indexRecord(params)` | Index with config-based formatting |
| `deleteRecord(params)` | Delete with config handling |
| `bulkIndexRecords(params[])` | Bulk index with formatting |
| `purgeEntity(params)` | Purge entity type from indexes |
| `reindexEntityToMeilisearch(params)` | Reindex single entity |
| `reindexAllToMeilisearch(params)` | Reindex all entities |
| `getEntityConfig(entityId)` | Get entity search configuration |
| `isEntityEnabled(entityId)` | Check if entity is search-enabled |
| `listEnabledEntities()` | List all enabled entities |

## REST API

### Search Endpoint

**`GET /api/search`**

Execute a search query via HTTP.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `limit` | number | No | Max results (default: 50, max: 100) |
| `strategies` | string | No | Comma-separated strategy IDs (e.g., `meilisearch,vector`) |

**Headers:**
- Requires authentication (session cookie or bearer token)
- Requires `search.view` feature permission

**Example Request:**

```bash
curl -X GET "https://your-app.com/api/search?q=john%20doe&limit=20" \
  -H "Authorization: Bearer <token>"
```

**Response:**

```json
{
  "results": [
    {
      "entityId": "customers:customer_person_profile",
      "recordId": "rec-123",
      "score": 0.95,
      "source": "meilisearch",
      "presenter": {
        "title": "John Doe",
        "subtitle": "Customer",
        "icon": "user"
      },
      "url": "/backend/customers/people/rec-123",
      "links": [
        { "label": "View", "url": "/backend/customers/people/rec-123" }
      ]
    }
  ],
  "strategiesUsed": ["meilisearch", "vector"],
  "timing": 45,
  "query": "john doe",
  "limit": 20
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing query parameter |
| 401 | Unauthorized |
| 503 | Search service unavailable |

### Other API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/search/reindex` | POST | Trigger Meilisearch reindex |
| `/api/search/embeddings/reindex` | POST | Trigger vector embeddings reindex |
| `/api/search/embeddings/status` | GET | Get vector indexing status |
| `/api/search/embeddings/config` | POST | Update embedding configuration |
| `/api/search/index` | GET | List indexed entries |
| `/api/search/index` | DELETE | Purge vector index |

## Types

### SearchOptions

```typescript
interface SearchOptions {
  tenantId: string
  organizationId?: string | null
  limit?: number
  strategies?: SearchStrategyId[]  // 'meilisearch' | 'vector' | 'tokens'
  entityTypes?: string[]           // Filter by entity types
}
```

### SearchResult

```typescript
interface SearchResult {
  entityId: string                 // e.g., 'customers:customer_person_profile'
  recordId: string                 // Primary key of the record
  score: number                    // Relevance score (0-1)
  source: SearchStrategyId         // Which strategy returned this result
  presenter?: {
    title: string                  // Display title
    subtitle?: string              // Secondary text
    icon?: string                  // Icon identifier
  }
  url?: string                     // Link to the record
  links?: Array<{
    label: string
    url: string
  }>
}
```

### IndexableRecord

```typescript
interface IndexableRecord {
  entityId: string
  recordId: string
  tenantId: string
  organizationId?: string | null
  fields: Record<string, unknown>  // Searchable field values
  presenter?: {
    title: string
    subtitle?: string
    icon?: string
  }
  url?: string
  links?: Array<{ label: string; url: string }>
}
```

## CLI Commands

The search module exposes CLI commands via `yarn mercato search <command>`.

### Status

Show search module status and available strategies:

```bash
yarn mercato search status
```

### Query

Execute a search query:

```bash
yarn mercato search query --query "search terms" --tenant <id> [options]
```

Options:
- `--query, -q` - Search query (required)
- `--tenant` - Tenant ID (required)
- `--org` - Organization ID (optional)
- `--entity` - Entity types to search (comma-separated)
- `--strategy` - Strategies to use (comma-separated: meilisearch, vector, tokens)
- `--limit` - Max results (default: 20)

### Index

Index a specific record:

```bash
yarn mercato search index --entity <entityId> --record <recordId> --tenant <tenantId>
```

Options:
- `--entity` - Entity ID (e.g., `customers:customer_person_profile`)
- `--record` - Record ID
- `--tenant` - Tenant ID
- `--org` - Organization ID (optional)

### Reindex

Reindex vector embeddings for entities:

```bash
yarn mercato search reindex --tenant <id> [options]
```

Options:
- `--tenant <id>` - Tenant scope (required for purge & coverage)
- `--org <id>` - Organization scope (requires tenant)
- `--entity <module:entity>` - Reindex a single entity (defaults to all enabled entities)
- `--partitions <n>` - Number of partitions to process in parallel
- `--partition <idx>` - Restrict to a specific partition index
- `--batch <n>` - Override batch size per chunk
- `--force` - Force reindex even if another job is running
- `--purgeFirst` - Purge vector rows before reindexing
- `--skipPurge` - Explicitly skip purging vector rows
- `--skipResetCoverage` - Keep existing coverage snapshots

Use `yarn mercato search reindex-help` for detailed options.

### Test Meilisearch

Test the Meilisearch connection:

```bash
yarn mercato search test-meilisearch
```

### Worker

Start a queue worker for processing search indexing jobs:

```bash
yarn mercato search worker <queue-name> [options]
```

Available queues:
- `vector-indexing` - Process vector embedding indexing jobs
- `meilisearch-indexing` - Process Meilisearch batch indexing jobs

Options:
- `--concurrency <n>` - Number of concurrent jobs to process (default: 1)

Examples:
```bash
# Start vector indexing worker with 10 concurrent jobs
yarn mercato search worker vector-indexing --concurrency=10

# Start Meilisearch indexing worker with 5 concurrent jobs
yarn mercato search worker meilisearch-indexing --concurrency=5
```

**Requirements:**
- `QUEUE_STRATEGY=async` must be set in environment
- Redis must be configured via `REDIS_URL` or `QUEUE_REDIS_URL`

### Help

Show all available commands:

```bash
yarn mercato search help
```

## Queue Configuration

The search module supports two queue strategies:

### Local Queue (Development)

File-based queue stored in `.queue/` directory. No additional configuration required.

```env
QUEUE_STRATEGY=local
```

### Async Queue (Production)

Redis-based queue using BullMQ for distributed processing.

```env
QUEUE_STRATEGY=async
REDIS_URL=redis://localhost:6379
```

When using async queues, start workers in separate processes:

```bash
# Terminal 1: Start vector indexing worker
yarn mercato search worker vector-indexing --concurrency=10

# Terminal 2: Start Meilisearch indexing worker
yarn mercato search worker meilisearch-indexing --concurrency=5
```

**Note:** If no workers are running when a reindex is triggered, the API will automatically fall back to synchronous processing and display a warning.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEILISEARCH_HOST` | Meilisearch server URL | - |
| `MEILISEARCH_API_KEY` | Meilisearch API key | - |
| `OPENAI_API_KEY` | OpenAI API key for embeddings | - |
| `OM_SEARCH_ENABLED` | Enable/disable search module | `true` |
| `QUEUE_STRATEGY` | Queue strategy (`local` or `async`) | `local` |
| `REDIS_URL` | Redis connection URL for async queues | - |
| `QUEUE_REDIS_URL` | Alternative Redis URL for queues | - |

## Architecture

```
packages/search/
├── src/
│   ├── modules/search/
│   │   ├── api/              # API routes
│   │   ├── cli.ts            # CLI commands
│   │   ├── di.ts             # Dependency injection
│   │   ├── subscribers/      # Event subscribers for auto-indexing
│   │   └── workers/          # Queue job handlers
│   ├── indexer/              # Search indexer implementation
│   ├── queue/                # Queue definitions
│   ├── strategies/           # Search strategy implementations
│   └── vector/               # Vector index service
```
