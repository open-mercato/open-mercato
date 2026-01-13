# Search Module - Agent Guidelines

This document describes how to configure and use the search module for indexing and searching entities across the Open Mercato platform.

## Overview

The search module provides unified search capabilities via three strategies:
- **Fulltext**: Fast, typo-tolerant search (requires external fulltext engine)
- **Vector**: Semantic/AI-powered search via embeddings
- **Tokens**: Exact keyword matching in PostgreSQL (always available)

## Creating a Search Configuration

Every module with searchable entities **MUST** provide a `search.ts` file.

### File Location
```
src/modules/<module>/search.ts
# or
packages/<package>/src/modules/<module>/search.ts
```

### Basic Structure

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

## Strategy Configuration

### Fulltext Strategy

Uses `fieldPolicy` to control which fields are indexed in the fulltext engine.

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

**Presenter**: Stored directly in the fulltext index during indexing.

### Vector Strategy

Uses `buildSource` to generate text for embeddings. The returned text is converted to vectors for semantic search.

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

**Presenter**: Returned from `buildSource.presenter` and stored alongside vectors.

### Tokens (Keyword) Strategy

Indexes automatically from `entity_indexes` table. No special configuration needed for indexing.

**Presenter**: Resolved at **search time** using `formatResult`. If not defined, falls back to extracting common fields from the document.

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

**Fallback fields** (when `formatResult` is not defined):
1. `display_name`, `displayName`
2. `name`, `title`, `label`
3. `full_name`, `fullName`
4. `first_name`, `firstName`
5. `email`, `primary_email`
6. `code`, `sku`, `reference`
7. Any other non-system string field

## SearchBuildContext

The context object passed to all config functions:

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

### Using QueryEngine in Config Functions

You can use `queryEngine` to load related data for richer search results:

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

## Complete Entity Config Reference

```typescript
{
  /** Entity identifier - must match entity registry */
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

## SearchResultPresenter

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

## SearchResultLink

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

## Auto-Indexing via Events

When CRUD routes have `indexer: { entityType }` configured, the search module automatically:
1. Subscribes to entity create/update/delete events
2. Indexes new/updated records using the search.ts config
3. Removes deleted records from all indexes

No manual indexing code is needed for standard CRUD operations.

## Environment Variables

| Variable | Required For | Description |
|----------|--------------|-------------|
| `MEILISEARCH_HOST` | Fulltext | Fulltext search server URL |
| `MEILISEARCH_API_KEY` | Fulltext | API key for fulltext server |
| `OPENAI_API_KEY` | Vector | OpenAI API key for embeddings |
| `QUEUE_STRATEGY` | Queues | `local` (dev) or `async` (prod) |
| `REDIS_URL` | Async queues | Redis connection URL |
| `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` | Security | Exclude encrypted fields from fulltext index |
| `DEBUG_SEARCH_ENRICHER` | Debug | Enable presenter enricher debug logs |

## Running Queue Workers

For production with `QUEUE_STRATEGY=async`:

```bash
# Fulltext indexing worker
yarn mercato search worker fulltext-indexing --concurrency=5

# Vector embedding indexing worker
yarn mercato search worker vector-indexing --concurrency=10
```

For development with `QUEUE_STRATEGY=local`, jobs process from `.queue/` automatically.

## CLI Commands

```bash
# Check search module status and available strategies
yarn mercato search status

# Trigger reindex for all strategies
yarn mercato search reindex --tenant <id>

# Reindex specific entity
yarn mercato search reindex --tenant <id> --entity <module:entity>

# Test search query
yarn mercato search query -q "search term" --tenant <id>

# Show all commands
yarn mercato search help
```

## Example: Full Search Config

See `packages/core/src/modules/customers/search.ts` for a comprehensive real-world example with:
- Multiple entities (person, company, deal, activity, comment)
- Related entity loading via queryEngine
- Custom field handling
- Presenter with fallback logic
- Field policies for sensitive data

## Common Patterns

### Loading Parent Entity for Display

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

### Handling Custom Fields

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

### Conditional Strategy Usage

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

### Sensitive Data Handling

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
