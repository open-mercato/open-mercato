import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

// ============================================================================
// Common Schemas
// ============================================================================

export const searchStrategyIdSchema = z.enum(['fulltext', 'vector', 'tokens'])

export const searchResultPresenterSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  badge: z.string().optional(),
})

export const searchResultLinkSchema = z.object({
  href: z.string(),
  label: z.string(),
  kind: z.enum(['primary', 'secondary']),
})

export const searchResultSchema = z.object({
  entityId: z.string().describe('Entity identifier (e.g., "customers:customer_person_profile")'),
  recordId: z.string().describe('Primary key of the record'),
  score: z.number().describe('Relevance score (0-1)'),
  source: searchStrategyIdSchema.describe('Which strategy returned this result'),
  presenter: searchResultPresenterSchema.optional(),
  url: z.string().optional(),
  links: z.array(searchResultLinkSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const errorResponseSchema = z.object({
  error: z.string(),
})

// ============================================================================
// Search Endpoint Schemas (/api/search)
// ============================================================================

export const searchQueryParamsSchema = z.object({
  q: z.string().describe('Search query (required)'),
  limit: z.coerce.number().min(1).max(100).optional().describe('Maximum results to return (default: 50, max: 100)'),
  strategies: z.string().optional().describe('Comma-separated strategies to use: fulltext, vector, tokens (e.g., "fulltext,vector")'),
  entityTypes: z.string().optional().describe('Comma-separated entity types to filter results (e.g., "customers:customer_person_profile,catalog:catalog_product,sales:sales_order")'),
})

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  strategiesUsed: z.array(searchStrategyIdSchema),
  timing: z.number().describe('Search duration in milliseconds'),
  query: z.string(),
  limit: z.number(),
})

// ============================================================================
// Global Search Endpoint Schemas (/api/search/global)
// ============================================================================

export const globalSearchQueryParamsSchema = z.object({
  q: z.string().describe('Search query (required)'),
  limit: z.coerce.number().min(1).max(100).optional().describe('Maximum results to return (default: 50, max: 100)'),
  entityTypes: z.string().optional().describe('Comma-separated entity types to filter results (e.g., "customers:customer_person_profile,catalog:catalog_product,sales:sales_order")'),
})

export const globalSearchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  strategiesUsed: z.array(searchStrategyIdSchema),
  strategiesEnabled: z.array(searchStrategyIdSchema),
  timing: z.number().describe('Search duration in milliseconds'),
  query: z.string(),
  limit: z.number(),
})

// ============================================================================
// Settings Endpoint Schemas (/api/search/settings)
// ============================================================================

export const strategyStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.number(),
  available: z.boolean(),
})

export const fulltextStatsSchema = z.object({
  numberOfDocuments: z.number(),
  isIndexing: z.boolean(),
  fieldDistribution: z.record(z.string(), z.number()),
})

export const reindexLockSchema = z.object({
  type: z.enum(['fulltext', 'vector']),
  action: z.string(),
  startedAt: z.string(),
  elapsedMinutes: z.number(),
  processedCount: z.number().nullable().optional(),
  totalCount: z.number().nullable().optional(),
})

export const searchSettingsSchema = z.object({
  strategies: z.array(strategyStatusSchema),
  fulltextConfigured: z.boolean(),
  fulltextStats: fulltextStatsSchema.nullable(),
  vectorConfigured: z.boolean(),
  tokensEnabled: z.boolean(),
  defaultStrategies: z.array(z.string()),
  reindexLock: reindexLockSchema.nullable().describe('Deprecated: Use fulltextReindexLock or vectorReindexLock'),
  fulltextReindexLock: reindexLockSchema.nullable(),
  vectorReindexLock: reindexLockSchema.nullable(),
})

export const settingsResponseSchema = z.object({
  settings: searchSettingsSchema,
})

// ============================================================================
// Global Search Settings Schemas (/api/search/settings/global-search)
// ============================================================================

export const globalSearchSettingsResponseSchema = z.object({
  enabledStrategies: z.array(searchStrategyIdSchema),
})

export const globalSearchSettingsUpdateSchema = z.object({
  enabledStrategies: z.array(searchStrategyIdSchema).min(1),
})

export const globalSearchSettingsUpdateResponseSchema = z.object({
  ok: z.boolean(),
  enabledStrategies: z.array(searchStrategyIdSchema),
})

// ============================================================================
// Reindex Endpoint Schemas (/api/search/reindex)
// ============================================================================

export const reindexRequestSchema = z.object({
  action: z.enum(['clear', 'recreate', 'reindex']).optional().describe('Action to perform (default: reindex)'),
  entityId: z.string().optional().describe('Specific entity ID to reindex (e.g., "customers:customer_person_profile", "catalog:catalog_product")'),
  useQueue: z.boolean().optional().describe('Whether to use queue (default: true)'),
})

export const reindexResultSchema = z.object({
  entitiesProcessed: z.number().optional(),
  recordsIndexed: z.number().optional(),
  jobsEnqueued: z.number().optional(),
  errors: z.array(z.object({
    entityId: z.string(),
    error: z.string(),
  })).optional(),
})

export const reindexResponseSchema = z.object({
  ok: z.boolean(),
  action: z.enum(['clear', 'recreate', 'reindex']),
  entityId: z.string().nullable(),
  useQueue: z.boolean().optional(),
  result: reindexResultSchema.optional(),
  stats: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()).optional(),
})

export const reindexConflictResponseSchema = z.object({
  error: z.string(),
  lock: reindexLockSchema,
})

// ============================================================================
// Index Endpoint Schemas (/api/search/index)
// ============================================================================

export const indexEntrySchema = z.object({
  id: z.string(),
  entityId: z.string(),
  recordId: z.string(),
  tenantId: z.string(),
  organizationId: z.string().nullable().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  createdAt: z.string().optional(),
})

export const indexListQueryParamsSchema = z.object({
  entityId: z.string().optional().describe('Filter by entity ID (e.g., "customers:customer_person_profile", "catalog:catalog_product")'),
  limit: z.coerce.number().min(1).max(200).optional().describe('Maximum entries to return (default: 50, max: 200)'),
  offset: z.coerce.number().min(0).optional().describe('Offset for pagination (default: 0)'),
})

export const indexListResponseSchema = z.object({
  entries: z.array(indexEntrySchema),
  limit: z.number(),
  offset: z.number(),
})

export const indexPurgeQueryParamsSchema = z.object({
  entityId: z.string().optional().describe('Specific entity ID to purge (e.g., "customers:customer_person_profile", "catalog:catalog_product")'),
  confirmAll: z.enum(['true']).optional().describe('Required when purging all entities'),
})

export const indexPurgeResponseSchema = z.object({
  ok: z.boolean(),
})

// ============================================================================
// Fulltext Settings Schemas (/api/search/settings/fulltext)
// ============================================================================

export const fulltextEnvVarStatusSchema = z.object({
  set: z.boolean(),
  hint: z.string(),
})

export const fulltextOptionalEnvVarStatusSchema = z.object({
  set: z.boolean(),
  value: z.union([z.string(), z.boolean()]).optional(),
  default: z.union([z.string(), z.boolean()]).optional(),
  hint: z.string(),
})

export const fulltextSettingsResponseSchema = z.object({
  driver: z.enum(['meilisearch']).nullable(),
  configured: z.boolean(),
  envVars: z.object({
    MEILISEARCH_HOST: fulltextEnvVarStatusSchema,
    MEILISEARCH_API_KEY: fulltextEnvVarStatusSchema,
  }),
  optionalEnvVars: z.object({
    MEILISEARCH_INDEX_PREFIX: fulltextOptionalEnvVarStatusSchema,
    SEARCH_EXCLUDE_ENCRYPTED_FIELDS: fulltextOptionalEnvVarStatusSchema,
  }),
})

// ============================================================================
// Vector Store Settings Schemas (/api/search/settings/vector-store)
// ============================================================================

export const vectorDriverEnvVarSchema = z.object({
  name: z.string(),
  set: z.boolean(),
  hint: z.string(),
})

export const vectorDriverStatusSchema = z.object({
  id: z.enum(['pgvector', 'qdrant', 'chromadb']),
  name: z.string(),
  configured: z.boolean(),
  implemented: z.boolean(),
  envVars: z.array(vectorDriverEnvVarSchema),
})

export const vectorStoreSettingsResponseSchema = z.object({
  currentDriver: z.enum(['pgvector', 'qdrant', 'chromadb']),
  configured: z.boolean(),
  drivers: z.array(vectorDriverStatusSchema),
})

// ============================================================================
// Embeddings Endpoint Schemas (/api/search/embeddings)
// ============================================================================

export const embeddingProviderIdSchema = z.enum(['openai', 'google', 'mistral', 'cohere', 'bedrock', 'ollama'])

export const embeddingConfigSchema = z.object({
  providerId: embeddingProviderIdSchema,
  model: z.string(),
  dimension: z.number(),
  outputDimensionality: z.number().optional(),
  baseUrl: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const embeddingsSettingsSchema = z.object({
  openaiConfigured: z.boolean(),
  autoIndexingEnabled: z.boolean(),
  autoIndexingLocked: z.boolean(),
  lockReason: z.string().nullable(),
  embeddingConfig: embeddingConfigSchema.nullable(),
  configuredProviders: z.array(embeddingProviderIdSchema),
  indexedDimension: z.number().nullable(),
  reindexRequired: z.boolean(),
  documentCount: z.number().nullable(),
})

export const embeddingsSettingsResponseSchema = z.object({
  settings: embeddingsSettingsSchema,
})

export const embeddingsSettingsUpdateSchema = z.object({
  autoIndexingEnabled: z.boolean().optional(),
  embeddingConfig: z.object({
    providerId: embeddingProviderIdSchema,
    model: z.string(),
    dimension: z.number(),
    outputDimensionality: z.number().optional(),
    baseUrl: z.string().optional(),
  }).optional(),
})

// ============================================================================
// Reindex Cancel Schemas (/api/search/reindex/cancel)
// ============================================================================

export const reindexCancelResponseSchema = z.object({
  ok: z.boolean(),
  jobsRemoved: z.number(),
})

// ============================================================================
// Vector Reindex Schemas (/api/search/embeddings/reindex)
// ============================================================================

export const vectorReindexRequestSchema = z.object({
  entityId: z.string().optional().describe('Specific entity ID to reindex (e.g., "customers:customer_person_profile", "catalog:catalog_product")'),
  purgeFirst: z.boolean().optional().describe('Purge existing entries before reindexing'),
})

export const vectorReindexResponseSchema = z.object({
  ok: z.boolean(),
  recordsIndexed: z.number().optional(),
  jobsEnqueued: z.number().optional(),
  entitiesProcessed: z.number().optional(),
  errors: z.array(z.object({
    entityId: z.string(),
    error: z.string(),
  })).optional(),
})

// ============================================================================
// OpenAPI Route Docs
// ============================================================================

export const searchOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Search across all indexed entities',
  description: 'Performs a search using configured strategies (fulltext, vector, tokens). Use for search playground.',
  methods: {
    GET: {
      summary: 'Search across all indexed entities',
      description: 'Performs a search using configured strategies (fulltext, vector, tokens). Use for search playground.',
      tags: ['Search'],
      query: searchQueryParamsSchema,
      responses: [
        { status: 200, description: 'Search results', schema: searchResponseSchema },
        { status: 400, description: 'Missing query parameter', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 500, description: 'Search failed', schema: errorResponseSchema },
        { status: 503, description: 'Search service unavailable', schema: errorResponseSchema },
      ],
    },
  },
}

export const globalSearchOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Global search (Cmd+K)',
  description: 'Performs a global search using saved tenant strategies. Does NOT accept strategies from URL.',
  methods: {
    GET: {
      summary: 'Global search (Cmd+K)',
      description: 'Performs a global search using saved tenant strategies. Does NOT accept strategies from URL.',
      tags: ['Search'],
      query: globalSearchQueryParamsSchema,
      responses: [
        { status: 200, description: 'Search results', schema: globalSearchResponseSchema },
        { status: 400, description: 'Missing query parameter', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 500, description: 'Search failed', schema: errorResponseSchema },
        { status: 503, description: 'Search service unavailable', schema: errorResponseSchema },
      ],
    },
  },
}

export const settingsOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Get search settings and status',
  description: 'Returns search module configuration, available strategies, and reindex lock status.',
  methods: {
    GET: {
      summary: 'Get search settings and status',
      description: 'Returns search module configuration, available strategies, and reindex lock status.',
      tags: ['Search'],
      responses: [
        { status: 200, description: 'Search settings', schema: settingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
  },
}

export const globalSearchSettingsOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Global search strategy settings',
  description: 'Manage enabled strategies for Cmd+K global search.',
  methods: {
    GET: {
      summary: 'Get global search strategies',
      description: 'Returns the enabled strategies for Cmd+K global search.',
      tags: ['Search'],
      responses: [
        { status: 200, description: 'Global search settings', schema: globalSearchSettingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Update global search strategies',
      description: 'Sets which strategies are enabled for Cmd+K global search.',
      tags: ['Search'],
      requestBody: { schema: globalSearchSettingsUpdateSchema },
      responses: [
        { status: 200, description: 'Updated settings', schema: globalSearchSettingsUpdateResponseSchema },
        { status: 400, description: 'Invalid request', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 500, description: 'Internal error', schema: errorResponseSchema },
      ],
    },
  },
}

export const reindexOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Trigger fulltext reindex',
  description: 'Starts a fulltext (Meilisearch) reindex operation. Can clear, recreate, or fully reindex.',
  methods: {
    POST: {
      summary: 'Trigger fulltext reindex',
      description: 'Starts a fulltext (Meilisearch) reindex operation. Can clear, recreate, or fully reindex.',
      tags: ['Search'],
      requestBody: { schema: reindexRequestSchema },
      responses: [
        { status: 200, description: 'Reindex result', schema: reindexResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 409, description: 'Reindex already in progress', schema: reindexConflictResponseSchema },
        { status: 500, description: 'Reindex failed', schema: errorResponseSchema },
        { status: 503, description: 'Search service unavailable', schema: errorResponseSchema },
      ],
    },
  },
}

export const reindexCancelOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Cancel fulltext reindex',
  description: 'Cancels an in-progress fulltext reindex operation.',
  methods: {
    POST: {
      summary: 'Cancel fulltext reindex',
      description: 'Cancels an in-progress fulltext reindex operation.',
      tags: ['Search'],
      responses: [
        { status: 200, description: 'Cancel result', schema: reindexCancelResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
  },
}

export const indexOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Vector index management',
  description: 'List and purge vector search index entries.',
  methods: {
    GET: {
      summary: 'List vector index entries',
      description: 'Returns paginated list of entries in the vector search index.',
      tags: ['Search'],
      query: indexListQueryParamsSchema,
      responses: [
        { status: 200, description: 'Index entries', schema: indexListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 500, description: 'Failed to fetch index', schema: errorResponseSchema },
        { status: 503, description: 'Vector strategy unavailable', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Purge vector index',
      description: 'Purges entries from the vector search index. Requires confirmAll=true when purging all entities.',
      tags: ['Search'],
      query: indexPurgeQueryParamsSchema,
      responses: [
        { status: 200, description: 'Purge result', schema: indexPurgeResponseSchema },
        { status: 400, description: 'Missing confirmAll parameter', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 500, description: 'Purge failed', schema: errorResponseSchema },
        { status: 503, description: 'Search indexer unavailable', schema: errorResponseSchema },
      ],
    },
  },
}

export const fulltextSettingsOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Get fulltext search configuration',
  description: 'Returns Meilisearch configuration status and index statistics.',
  methods: {
    GET: {
      summary: 'Get fulltext search configuration',
      description: 'Returns Meilisearch configuration status and index statistics.',
      tags: ['Search'],
      responses: [
        { status: 200, description: 'Fulltext settings', schema: fulltextSettingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
  },
}

export const vectorStoreSettingsOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Get vector store configuration',
  description: 'Returns vector store configuration status.',
  methods: {
    GET: {
      summary: 'Get vector store configuration',
      description: 'Returns vector store configuration status.',
      tags: ['Search'],
      responses: [
        { status: 200, description: 'Vector store settings', schema: vectorStoreSettingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
  },
}

export const embeddingsOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Embeddings configuration',
  description: 'Manage embedding provider and model configuration.',
  methods: {
    GET: {
      summary: 'Get embeddings configuration',
      description: 'Returns current embedding provider and model configuration.',
      tags: ['Search'],
      responses: [
        { status: 200, description: 'Embeddings settings', schema: embeddingsSettingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
    POST: {
      summary: 'Update embeddings configuration',
      description: 'Updates the embedding provider and model settings.',
      tags: ['Search'],
      requestBody: { schema: embeddingsSettingsUpdateSchema },
      responses: [
        { status: 200, description: 'Updated settings', schema: embeddingsSettingsResponseSchema },
        { status: 400, description: 'Invalid request', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 409, description: 'Auto-indexing disabled via environment', schema: errorResponseSchema },
        { status: 500, description: 'Update failed', schema: errorResponseSchema },
        { status: 503, description: 'Configuration service unavailable', schema: errorResponseSchema },
      ],
    },
  },
}

export const embeddingsReindexOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Trigger vector reindex',
  description: 'Starts a vector embedding reindex operation.',
  methods: {
    POST: {
      summary: 'Trigger vector reindex',
      description: 'Starts a vector embedding reindex operation.',
      tags: ['Search'],
      requestBody: { schema: vectorReindexRequestSchema },
      responses: [
        { status: 200, description: 'Reindex result', schema: vectorReindexResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 409, description: 'Reindex already in progress', schema: reindexConflictResponseSchema },
        { status: 500, description: 'Reindex failed', schema: errorResponseSchema },
        { status: 503, description: 'Search indexer unavailable', schema: errorResponseSchema },
      ],
    },
  },
}

export const embeddingsReindexCancelOpenApi: OpenApiRouteDoc = {
  tag: 'Search',
  summary: 'Cancel vector reindex',
  description: 'Cancels an in-progress vector reindex operation.',
  methods: {
    POST: {
      summary: 'Cancel vector reindex',
      description: 'Cancels an in-progress vector reindex operation.',
      tags: ['Search'],
      responses: [
        { status: 200, description: 'Cancel result', schema: reindexCancelResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
  },
}
