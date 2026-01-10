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

## Configuring Entities for Search

Each module can define which entities are searchable by creating a `search.ts` file in the module root.

### Entity Configuration Structure

```typescript
// packages/your-package/src/modules/your-module/search.ts
import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchIndexSource,
  SearchResultPresenter,
  SearchResultLink,
} from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'your_module:your_entity',  // Must match entity registry
      enabled: true,
      priority: 10,  // Higher = appears first in mixed results

      // FOR VECTOR SEARCH: buildSource generates text for embeddings
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const lines: string[] = []

        // Add text that should be searchable semantically
        lines.push(`Name: ${ctx.record.name}`)
        lines.push(`Description: ${ctx.record.description}`)

        // Include custom fields
        if (ctx.customFields.notes) {
          lines.push(`Notes: ${ctx.customFields.notes}`)
        }

        if (!lines.length) return null

        return {
          text: lines,  // This text gets embedded for vector search
          presenter: {
            title: ctx.record.name,
            subtitle: ctx.record.description,
            icon: 'lucide:file',
          },
          links: [
            { href: `/your-entity/${ctx.record.id}`, label: 'View', kind: 'primary' }
          ],
          checksumSource: { record: ctx.record, customFields: ctx.customFields },
        }
      },

      // FOR MEILISEARCH: fieldPolicy controls full-text indexing
      fieldPolicy: {
        searchable: ['name', 'description', 'notes'],  // Indexed for full-text
        hashOnly: ['email', 'phone'],                   // Hashed, not searchable
        excluded: ['password', 'secret'],               // Never indexed
      },

      // Optional: Custom presenter formatting
      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        return {
          title: ctx.record.name,
          subtitle: ctx.record.status,
          icon: 'lucide:user',
        }
      },

      // Optional: Primary URL for the record
      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        return `/your-entity/${ctx.record.id}`
      },

      // Optional: Additional action links
      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        return [
          { href: `/your-entity/${ctx.record.id}/edit`, label: 'Edit', kind: 'secondary' }
        ]
      },
    },
  ],
}

export default searchConfig
```

### Search Strategies Comparison

| Aspect | Meilisearch | Vector Search | Token Search |
|--------|-------------|---------------|--------------|
| **Configuration** | `fieldPolicy` | `buildSource` | Automatic |
| **Search Type** | Full-text with typo tolerance | Semantic similarity | Exact token matching |
| **Good For** | Exact matches, filters, facets | Natural language, "find similar" | Simple lookups |
| **Backend** | Meilisearch server | pgvector/Qdrant/ChromaDB + embeddings | PostgreSQL |
| **Requires** | `MEILISEARCH_HOST` | `OPENAI_API_KEY` (or other provider) | Database connection |

### Enabling/Disabling Strategies

You can control which strategies are used at multiple levels:

#### Per Entity

```typescript
// Meilisearch only (no vector search)
{
  entityId: 'your_module:your_entity',
  enabled: true,
  // NO buildSource = no vector search
  fieldPolicy: {
    searchable: ['name', 'description'],
  },
}

// Vector only (no Meilisearch)
{
  entityId: 'your_module:your_entity',
  enabled: true,
  buildSource: async (ctx) => ({ text: [...], presenter: {...} }),
  // NO fieldPolicy = no Meilisearch
}

// Both strategies
{
  entityId: 'your_module:your_entity',
  enabled: true,
  buildSource: async (ctx) => ({ text: [...], presenter: {...} }),
  fieldPolicy: { searchable: ['name'] },
}
```

#### Global Level (DI Registration)

In `packages/core/src/bootstrap.ts`:

```typescript
import { registerSearchModule } from '@open-mercato/search'

registerSearchModule(container, {
  moduleConfigs: searchModuleConfigs,
  skipVector: true,      // Disable vector search globally
  skipMeilisearch: true, // Disable Meilisearch globally
  skipTokens: true,      // Disable token search globally
})
```

#### Per Query

```typescript
// Only use Meilisearch for this search
const results = await searchService.search('query', {
  tenantId: '...',
  strategies: ['meilisearch'],
})

// Only use vector search
const results = await searchService.search('query', {
  tenantId: '...',
  strategies: ['vector'],
})

// Use all available strategies (default)
const results = await searchService.search('query', {
  tenantId: '...',
})
```

#### Environment-Based

Strategies automatically become unavailable if their backend is not configured:

| Strategy | Required Environment |
|----------|---------------------|
| Meilisearch | `MEILISEARCH_HOST` |
| Vector | `OPENAI_API_KEY` (or other embedding provider) |
| Tokens | Database connection (always available) |

### SearchBuildContext

The context object passed to `buildSource` and other config functions:

```typescript
interface SearchBuildContext {
  record: Record<string, unknown>       // The database record
  customFields: Record<string, unknown> // Custom field values (cf:* fields)
  tenantId?: string | null
  organizationId?: string | null
  queryEngine?: QueryEngine             // For loading related entities
}
```

### SearchIndexSource

The return type from `buildSource`:

```typescript
interface SearchIndexSource {
  text: string | string[]              // Text to embed for vector search
  presenter?: SearchResultPresenter    // Display info for search results
  links?: SearchResultLink[]           // Action links
  checksumSource?: unknown             // Used for change detection
}
```

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
