# Search Module - Agent Guidelines

When working on search functionality, use this guide. It covers indexing, querying, and configuring search across all entity types.

## MUST / MUST NOT Rules

1. **MUST** create a `search.ts` file for every module with searchable entities.
2. **MUST** define `fieldPolicy.excluded` for any sensitive fields (passwords, tokens, SSNs, bank accounts) -- never allow them into any index.
3. **MUST** define `formatResult` for every entity that uses the tokens strategy -- without it, users see raw UUIDs instead of names.
4. **MUST** include `checksumSource` in every `buildSource` return value so the indexer can detect changes and skip redundant re-embedding.
5. **MUST** use the `entityId` format `module:entity_name` and ensure it matches the entity registry exactly.
6. **MUST NOT** call raw `fetch` against the search API -- use `apiCall`/`apiCallOrThrow` from `@open-mercato/ui/backend/utils/apiCall`.
7. **MUST NOT** include encrypted or sensitive fields in `buildSource` text output -- they end up in plain text in vector stores.
8. **MUST NOT** skip `fieldPolicy.hashOnly` for PII fields (email, phone, tax_id) that need exact-match filtering but not fuzzy search.

## Search Strategies -- When to Use Each

Choose strategies based on what users need:

| Strategy | When to use | Backend required |
|----------|-------------|------------------|
| **Fulltext** | When users need fast, typo-tolerant search (names, descriptions, titles) | Meilisearch (`MEILISEARCH_HOST`) |
| **Vector** | When users need semantic/meaning-based search ("find customers interested in automation") | Embedding provider (`OPENAI_API_KEY` or Ollama) |
| **Tokens** | When you need baseline keyword search that always works, even without external services | PostgreSQL (always available) |

Strategies automatically become unavailable if their backend is not configured (e.g., no `MEILISEARCH_HOST` means fulltext is unavailable).

## Configure Global Search (Cmd+K)

Set global search dialog strategies per-tenant via **Settings > Search** or the API:

```typescript
// Get current config
GET /api/search/settings/global-search
// Response: { "enabledStrategies": ["fulltext", "vector", "tokens"] }

// Update config
POST /api/search/settings/global-search
// Body: { "enabledStrategies": ["fulltext", "tokens"] }
```

## Create a Search Configuration

### Place the file here

```
src/modules/<module>/search.ts
# or
packages/<package>/src/modules/<module>/search.ts
```

### Follow this structure

```typescript
import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchIndexSource,
  SearchResultPresenter,
  SearchResultLink,
} from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  // Optional: Override default strategies for all entities in this module
  defaultStrategies: ['fulltext', 'vector', 'tokens'],

  entities: [
    {
      entityId: 'your_module:your_entity',  // Must match entity registry
      enabled: true,                         // Toggle search on/off (default: true)
      priority: 10,                          // Higher = appears first in mixed results

      // Strategy-specific configurations below...
    },
  ],
}

export default searchConfig
```

## Configure Each Strategy

### Configure Fulltext

Use `fieldPolicy` to control which fields are indexed in the fulltext engine.

```typescript
{
  entityId: 'your_module:your_entity',

  fieldPolicy: {
    // Indexed and searchable with typo tolerance
    searchable: ['name', 'description', 'title', 'notes'],

    // Hashed for exact match only (e.g., for filtering, not fuzzy search)
    hashOnly: ['email', 'phone', 'tax_id'],

    // Never indexed (sensitive data)
    excluded: ['password', 'ssn', 'bank_account', 'api_key'],
  },
}
```

Presenter data is stored directly in the fulltext index during indexing.

### Configure Vector

Use `buildSource` to generate text for embeddings. The returned text is converted to vectors for semantic search.

```typescript
{
  entityId: 'your_module:your_entity',

  buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
    const lines: string[] = []

    // Add searchable text - this gets embedded as vectors
    lines.push(`Name: ${ctx.record.name}`)
    lines.push(`Description: ${ctx.record.description}`)

    // Include custom fields
    if (ctx.customFields.notes) {
      lines.push(`Notes: ${ctx.customFields.notes}`)
    }

    // Load related data if needed
    if (ctx.queryEngine) {
      const related = await ctx.queryEngine.query('other:entity', {
        tenantId: ctx.tenantId,
        filters: { id: ctx.record.related_id },
      })
      if (related.items[0]?.name) {
        lines.push(`Related: ${related.items[0].name}`)
      }
    }

    if (!lines.length) return null

    return {
      text: lines,  // String or string[] - gets embedded
      presenter: {
        title: ctx.record.name,
        subtitle: ctx.record.status,
        icon: 'lucide:file',
        badge: 'Your Entity',
      },
      links: [
        { href: `/backend/your-module/${ctx.record.id}`, label: 'View', kind: 'primary' },
        { href: `/backend/your-module/${ctx.record.id}/edit`, label: 'Edit', kind: 'secondary' },
      ],
      // Used for change detection - only re-index if this changes
      checksumSource: {
        record: ctx.record,
        customFields: ctx.customFields,
      },
    }
  },
}
```

Presenter data is returned from `buildSource.presenter` and stored alongside vectors.

### Configure Tokens (Keyword)

Tokens index automatically from the `entity_indexes` table. No special indexing configuration needed.

Presenter is resolved at **search time** using `formatResult`. When `formatResult` is not defined, the system falls back to extracting common fields from the document.

```typescript
{
  entityId: 'your_module:your_entity',

  // REQUIRED for token search to show meaningful titles instead of UUIDs
  formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
    return {
      title: ctx.record.display_name ?? ctx.record.name ?? 'Unknown',
      subtitle: ctx.record.email ?? ctx.record.status,
      icon: 'lucide:user',
      badge: 'Customer',
    }
  },
}
```

**Fallback field resolution order** (when `formatResult` is not defined):
1. `display_name`, `displayName`
2. `name`, `title`, `label`
3. `full_name`, `fullName`
4. `first_name`, `firstName`
5. `email`, `primary_email`
6. `code`, `sku`, `reference`
7. Any other non-system string field

## Use SearchBuildContext

When you need to access record data, custom fields, or related entities inside config functions, use the context object:

```typescript
interface SearchBuildContext {
  /** The database record being indexed */
  record: Record<string, unknown>

  /** Custom fields for the record (cf:* fields without prefix) */
  customFields: Record<string, unknown>

  /** Tenant ID (always available) */
  tenantId?: string | null

  /** Organization ID (if applicable) */
  organizationId?: string | null

  /** Query engine for loading related entities */
  queryEngine?: QueryEngine
}
```

### Load Related Data via QueryEngine

When you need richer search results that include parent or related entity names, use `queryEngine`:

```typescript
formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
  // Load parent entity for better display
  let parentName = 'Unknown'
  if (ctx.queryEngine && ctx.record.parent_id) {
    const result = await ctx.queryEngine.query('module:parent_entity', {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      filters: { id: ctx.record.parent_id },
      page: { page: 1, pageSize: 1 },
    })
    parentName = result.items[0]?.name ?? 'Unknown'
  }

  return {
    title: ctx.record.name,
    subtitle: `Parent: ${parentName}`,
    icon: 'lucide:folder',
  }
}
```

## Follow This Template When Configuring Search Entities

```typescript
{
  /** Entity identifier - MUST match entity registry */
  entityId: 'module:entity_name',

  /** Enable/disable search for this entity (default: true) */
  enabled: true,

  /** Result ordering priority - higher appears first (default: 0) */
  priority: 10,

  /** Override strategies for this specific entity */
  strategies: ['fulltext', 'tokens'],

  /** FOR VECTOR: Generate text for embeddings */
  buildSource: async (ctx) => ({ text: [...], presenter: {...}, checksumSource: {...} }),

  /** FOR TOKENS: Format result at search time */
  formatResult: async (ctx) => ({ title: '...', subtitle: '...', icon: '...' }),

  /** Primary URL when result is clicked */
  resolveUrl: async (ctx) => `/backend/module/${ctx.record.id}`,

  /** Additional action links */
  resolveLinks: async (ctx) => [
    { href: `/backend/module/${ctx.record.id}`, label: 'View', kind: 'primary' },
    { href: `/backend/module/${ctx.record.id}/edit`, label: 'Edit', kind: 'secondary' },
  ],

  /** FOR FULLTEXT: Control field indexing */
  fieldPolicy: {
    searchable: ['name', 'description'],
    hashOnly: ['email'],
    excluded: ['password'],
  },
}
```

## Use These Types for Search Results

### When you need to define presenter display data, use SearchResultPresenter

```typescript
interface SearchResultPresenter {
  /** Main display text (required) */
  title: string

  /** Secondary text shown below title */
  subtitle?: string

  /** Icon identifier (e.g., 'lucide:user', 'user', 'building') */
  icon?: string

  /** Badge/tag shown next to title (e.g., 'Customer', 'Deal') */
  badge?: string
}
```

### When you need to define action links on results, use SearchResultLink

```typescript
interface SearchResultLink {
  /** URL to navigate to */
  href: string

  /** Link label text */
  label: string

  /** Link style: 'primary' (main action) or 'secondary' (additional) */
  kind: 'primary' | 'secondary'
}
```

### When you need to pass search parameters, use SearchOptions

```typescript
interface SearchOptions {
  tenantId: string
  organizationId?: string | null
  limit?: number
  offset?: number
  strategies?: SearchStrategyId[]  // 'fulltext' | 'vector' | 'tokens'
  entityTypes?: string[]           // Filter by entity types
}
```

### When you need to read search results, use SearchResult

```typescript
interface SearchResult {
  entityId: string                 // e.g., 'customers:customer_person_profile'
  recordId: string                 // Primary key of the record
  score: number                    // Relevance score (0-1)
  source: SearchStrategyId         // Which strategy returned this result
  presenter?: SearchResultPresenter
  url?: string
  links?: SearchResultLink[]
  metadata?: Record<string, unknown>
}
```

### When you need to build an indexable document, use IndexableRecord

```typescript
interface IndexableRecord {
  entityId: string
  recordId: string
  tenantId: string
  organizationId?: string | null
  fields: Record<string, unknown>  // Searchable field values
  presenter?: SearchResultPresenter
  url?: string
  links?: SearchResultLink[]
  text?: string | string[]         // For vector embeddings
  checksumSource?: unknown         // For change detection
}
```

## Rely on Auto-Indexing via Events

When CRUD routes have `indexer: { entityType }` configured, the search module automatically:
1. Subscribes to entity create/update/delete events
2. Indexes new/updated records using the search.ts config
3. Removes deleted records from all indexes

No manual indexing code is needed for standard CRUD operations.

## Integrate Programmatically via DI

When you need search functionality from another module, resolve services from the DI container.

### Use SearchService for Direct Search and Index Operations

```typescript
import type { SearchService } from '@open-mercato/search'

const searchService = container.resolve('searchService') as SearchService

// Execute a search
const results = await searchService.search('john doe', {
  tenantId: 'tenant-123',
  organizationId: 'org-456',
  limit: 20,
  strategies: ['fulltext', 'vector'],
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

// Bulk index, delete, purge
await searchService.bulkIndex([record1, record2])
await searchService.delete('customers:customer_person_profile', 'rec-123', 'tenant-123')
await searchService.purge('customers:customer_person_profile', 'tenant-123')
```

### Use SearchIndexer for Config-Aware Indexing

When you need automatic presenter/URL resolution based on `search.ts` config, use `SearchIndexer`:

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

// Index by ID (loads record from database)
const result = await searchIndexer.indexRecordById({
  entityId: 'customers:customer_person_profile',
  recordId: 'rec-123',
  tenantId: 'tenant-123',
})

// Check entity configuration
if (searchIndexer.isEntityEnabled('customers:customer_person_profile')) {
  // Entity is configured for indexing
}

// Reindex operations
await searchIndexer.reindexEntity({ entityId, tenantId, purgeFirst: true })
await searchIndexer.reindexAll({ tenantId, purgeFirst: true })
```

### DI Token Reference

| Token | Type | When to use |
|-------|------|-------------|
| `searchService` | `SearchService` | When you need to execute searches or directly index/delete records |
| `searchIndexer` | `SearchIndexer` | When you need config-aware indexing with automatic presenter resolution |
| `searchStrategies` | `SearchStrategy[]` | When you need to inspect or iterate over registered strategy instances |
| `fulltextIndexQueue` | `Queue` | When you need to enqueue or monitor fulltext indexing jobs directly |
| `vectorIndexQueue` | `Queue` | When you need to enqueue or monitor vector indexing jobs directly |

## REST API

### Query via GET /api/search

| Parameter | Type | Required | MUST rules |
|-----------|------|----------|------------|
| `q` | string | Yes | MUST be non-empty; this is the search query |
| `limit` | number | No | MUST NOT exceed 100 (default: 50) |
| `strategies` | string | No | Comma-separated: `fulltext,vector,tokens` |

```bash
curl "https://your-app.com/api/search?q=john%20doe&limit=20" \
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
      "source": "fulltext",
      "presenter": { "title": "John Doe", "subtitle": "Customer" },
      "url": "/backend/customers/people/rec-123"
    }
  ],
  "strategiesUsed": ["fulltext", "vector"],
  "timing": 45
}
```

### Other Endpoints

| Endpoint | Method | Permission | When to use |
|----------|--------|------------|-------------|
| `/api/search/settings/global-search` | GET | `search.view` | When you need to read which strategies are enabled for Cmd+K |
| `/api/search/settings/global-search` | POST | `search.manage` | When you need to update enabled strategies for a tenant |
| `/api/search/reindex` | POST | `search.manage` | When you need to trigger a fulltext reindex (after bulk data changes) |
| `/api/search/embeddings/reindex` | POST | `search.manage` | When you need to trigger a vector reindex (after embedding config changes) |
| `/api/search/embeddings/status` | GET | `search.view` | When you need to check vector indexing progress or errors |

## Environment Variables

| Variable | When to configure | MUST rules |
|----------|-------------------|------------|
| `MEILISEARCH_HOST` | When enabling fulltext search | MUST be a valid URL to a running Meilisearch instance |
| `MEILISEARCH_API_KEY` | When enabling fulltext search | MUST match the Meilisearch server's master or admin key |
| `OPENAI_API_KEY` | When enabling vector search with OpenAI | MUST be a valid OpenAI API key with embeddings access |
| `QUEUE_STRATEGY` | When choosing job processing mode | Set `local` for dev, `async` for production |
| `REDIS_URL` | When using `QUEUE_STRATEGY=async` | MUST be a valid Redis connection URL |
| `QUEUE_REDIS_URL` | When using a separate Redis for queues | Alternative to `REDIS_URL` for queue-specific connections |
| `OM_SEARCH_ENABLED` | When you need to disable the search module entirely | Default: `true`; set to `false` to disable |
| `OM_SEARCH_DEBUG` | When debugging search behavior | Enables verbose debug logging |
| `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` | When you need to keep encrypted fields out of fulltext | Set to `true` to exclude encrypted fields from fulltext index |
| `DEBUG_SEARCH_ENRICHER` | When debugging presenter enrichment | Enables presenter enricher debug logs |

## Run Queue Workers

For production with `QUEUE_STRATEGY=async`:

```bash
# Fulltext indexing worker
yarn mercato search worker fulltext-indexing --concurrency=5

# Vector embedding indexing worker
yarn mercato search worker vector-indexing --concurrency=10
```

For development with `QUEUE_STRATEGY=local`, jobs process from `.queue/` automatically.

## Use CLI Commands

### Check status
```bash
yarn mercato search status
```
Shows search module status, available strategies, and configuration.

### Run a search query
```bash
yarn mercato search query -q "search term" --tenant <id> [options]
```
Options:
- `--query, -q` - Search query (required)
- `--tenant` - Tenant ID (required)
- `--org` - Organization ID
- `--entity` - Entity types (comma-separated)
- `--strategy` - Strategies to use: `fulltext,vector,tokens`
- `--limit` - Max results (default: 20)

### Index a single record
```bash
yarn mercato search index --entity <entityId> --record <recordId> --tenant <id>
```
Options:
- `--entity` - Entity ID (e.g., `customers:customer_person_profile`)
- `--record` - Record ID
- `--tenant` - Tenant ID
- `--org` - Organization ID

### Reindex entities
```bash
yarn mercato search reindex --tenant <id> [options]
```
Options:
- `--tenant` - Tenant scope (required)
- `--org` - Organization scope
- `--entity` - Single entity to reindex (defaults to all)
- `--force` - Force reindex even if another job is running
- `--purgeFirst` - Purge before reindexing
- `--partitions` - Number of parallel partitions
- `--batch` - Override batch size

### Test Meilisearch connection
```bash
yarn mercato search test-meilisearch
```

### Start a queue worker
```bash
yarn mercato search worker <queue-name> --concurrency=<n>
```
Queues: `fulltext-indexing`, `vector-indexing`

### Show help
```bash
yarn mercato search help
```

## Reference: Full Search Config Example

See `packages/core/src/modules/customers/search.ts` for the reference implementation with:
- Multiple entities (person, company, deal, activity, comment)
- Related entity loading via queryEngine
- Custom field handling
- Presenter with fallback logic
- Field policies for sensitive data

## Common Patterns

### Load a Parent Entity for Display

```typescript
formatResult: async (ctx) => {
  const parent = ctx.queryEngine
    ? await loadParent(ctx.queryEngine, ctx.record.parent_id, ctx.tenantId)
    : null

  return {
    title: ctx.record.name,
    subtitle: parent?.display_name ?? 'No parent',
    icon: 'lucide:file',
  }
}
```

### Include Custom Fields in Vector Source

```typescript
buildSource: async (ctx) => {
  const lines: string[] = []

  // Standard fields
  lines.push(`Name: ${ctx.record.name}`)

  // Custom fields (already extracted without cf: prefix)
  for (const [key, value] of Object.entries(ctx.customFields)) {
    if (value != null) {
      lines.push(`${formatLabel(key)}: ${value}`)
    }
  }

  return { text: lines, presenter: {...} }
}
```

### Use Only Specific Strategies

```typescript
{
  entityId: 'module:entity',

  // Only fulltext - no vector embeddings
  fieldPolicy: { searchable: ['name'] },
  // NO buildSource = no vector search

  // formatResult still needed for token search fallback
  formatResult: async (ctx) => ({ title: ctx.record.name }),
}
```

### Protect Sensitive Data

```typescript
{
  entityId: 'module:entity',

  fieldPolicy: {
    searchable: ['name', 'description'],
    hashOnly: ['email', 'phone'],           // Exact match only
    excluded: ['ssn', 'password', 'token'], // Never indexed
  },

  // In buildSource, skip sensitive fields
  buildSource: async (ctx) => {
    const lines: string[] = []
    lines.push(`Name: ${ctx.record.name}`)
    // Do NOT include: ctx.record.ssn, ctx.record.password
    return { text: lines, presenter: {...} }
  },
}
```

## Checklist: Add Search to a New Module

- [ ] Create `search.ts` in the module directory
- [ ] Export `searchConfig` with correct `entityId` matching the entity registry
- [ ] Define `fieldPolicy` for fulltext (mark sensitive fields as `excluded` or `hashOnly`)
- [ ] Define `buildSource` for vector search (include `checksumSource`)
- [ ] Define `formatResult` for tokens strategy
- [ ] Define `resolveUrl` and `resolveLinks` for result navigation
- [ ] Set `priority` to control ordering in mixed results
- [ ] Verify CRUD routes include `indexer: { entityType }` for auto-indexing
- [ ] Run `npm run modules:prepare` after adding the file
- [ ] Test with `yarn mercato search query -q "test" --tenant <id>`

## Checklist: Debug Search Issues

- [ ] Run `yarn mercato search status` to verify strategies and connectivity
- [ ] Run `yarn mercato search test-meilisearch` if fulltext is not returning results
- [ ] Check `OM_SEARCH_ENABLED` is not set to `false`
- [ ] Enable `OM_SEARCH_DEBUG=true` for verbose logging
- [ ] Enable `DEBUG_SEARCH_ENRICHER=true` if presenters are missing or wrong
- [ ] Verify the entity has `enabled: true` (or omitted, since default is `true`)
- [ ] Verify the CRUD route has `indexer: { entityType }` for auto-indexing
- [ ] Check queue workers are running if using `QUEUE_STRATEGY=async`

## Where to Find Code When Modifying Search

```
packages/search/src/
├── modules/search/
│   ├── api/              # REST API routes
│   ├── cli.ts            # CLI commands
│   ├── di.ts             # DI registration
│   ├── subscribers/      # Event subscribers (fulltext_upsert, vector_upsert, delete)
│   └── workers/          # Queue workers (fulltext-index, vector-index)
├── fulltext/             # Fulltext drivers (Meilisearch)
├── indexer/              # SearchIndexer implementation
├── queue/                # Queue definitions
├── strategies/           # Strategy implementations
├── vector/               # Vector index service
└── service.ts            # SearchService implementation
```

See `packages/search/src/modules/search/README.md` for complete API reference and advanced configuration.
