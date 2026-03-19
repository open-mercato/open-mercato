# Search Package — Standalone Developer Guide

`@open-mercato/search` provides fulltext, vector, and token-based search. Configure search for your entities via `search.ts` in your module.

## Strategy Overview

| Strategy | Backend | Use when |
|----------|---------|----------|
| **Fulltext** | Meilisearch | Fast, typo-tolerant search (names, titles, descriptions) |
| **Vector** | OpenAI / Ollama | Semantic, meaning-based search ("find customers interested in X") |
| **Tokens** | PostgreSQL | Baseline keyword search, always available, no external services |

Strategies auto-degrade when their backend is not configured.

## Adding Search to a Module

Create `src/modules/<module>/search.ts`:

```typescript
import type { SearchModuleConfig, SearchBuildContext } from '@open-mercato/shared/modules/search'

export const searchConfig: SearchModuleConfig = {
  entities: [{
    entityId: 'my_module:my_entity',  // MUST match entity registry
    priority: 10,

    // Fulltext: control field indexing
    fieldPolicy: {
      searchable: ['name', 'description'],
      hashOnly: ['email', 'phone'],      // exact match only
      excluded: ['password', 'api_key'],  // never indexed
    },

    // Vector: generate text for embeddings
    buildSource: async (ctx: SearchBuildContext) => ({
      text: [`Name: ${ctx.record.name}`, `Description: ${ctx.record.description}`],
      presenter: { title: ctx.record.name, subtitle: ctx.record.status, icon: 'lucide:file', badge: 'Item' },
      links: [{ href: `/backend/my-module/${ctx.record.id}`, label: 'View', kind: 'primary' }],
      checksumSource: { record: ctx.record, customFields: ctx.customFields },
    }),

    // Tokens: format at search time
    formatResult: async (ctx: SearchBuildContext) => ({
      title: ctx.record.name ?? 'Unknown',
      subtitle: ctx.record.status,
      icon: 'lucide:file',
      badge: 'Item',
    }),

    resolveUrl: async (ctx) => `/backend/my-module/${ctx.record.id}`,
  }],
}
export default searchConfig
```

Run `yarn generate` after creating the file.

## MUST Rules

1. **MUST create `search.ts`** for every module with searchable entities
2. **MUST define `fieldPolicy.excluded`** for sensitive fields (passwords, tokens, SSNs)
3. **MUST define `formatResult`** for every entity using the tokens strategy
4. **MUST include `checksumSource`** in every `buildSource` return value
5. **MUST NOT** include encrypted/sensitive fields in `buildSource` text
6. **MUST NOT** use raw `fetch` against search API — use `apiCall`/`apiCallOrThrow`

## Auto-Indexing

When CRUD routes have `indexer: { entityType }`, the search module automatically subscribes to entity CRUD events and indexes/removes records. No manual indexing code needed.

## CLI Commands

```bash
yarn mercato search status                           # Check strategies and connectivity
yarn mercato search query -q "term" --tenant <id>    # Run a search
yarn mercato search reindex --tenant <id>             # Reindex all entities
yarn mercato search reindex --entity my_module:my_entity --tenant <id>  # Reindex specific entity
yarn mercato search test-meilisearch                  # Test Meilisearch connection
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MEILISEARCH_HOST` | Meilisearch URL (enables fulltext) |
| `MEILISEARCH_API_KEY` | Meilisearch auth key |
| `OPENAI_API_KEY` | OpenAI API key (enables vector search) |
| `OM_SEARCH_DEBUG` | Enable verbose debug logging |

## Programmatic Search via DI

```typescript
const searchService = container.resolve('searchService')
const results = await searchService.search('query', {
  tenantId: 'tenant-123',
  limit: 20,
  strategies: ['fulltext', 'vector'],
})
```

## SearchBuildContext

Both `buildSource` and `formatResult` receive this context:

```typescript
interface SearchBuildContext {
  record: Record<string, unknown>       // The database record
  customFields: Record<string, unknown> // Custom fields (without cf: prefix)
  tenantId?: string | null
  organizationId?: string | null
  queryEngine?: QueryEngine             // For loading related entities
}
```

Use `queryEngine` to load parent/related entities for richer presenter data.
