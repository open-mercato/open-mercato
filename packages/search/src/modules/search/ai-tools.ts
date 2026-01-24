import { z } from 'zod'
import type { SearchResult, SearchStrategyId } from '@open-mercato/shared/modules/search'

/**
 * AI Tools definitions for the Search module.
 *
 * These tool definitions are discovered by the ai-assistant module's generator
 * and registered as MCP tools. The search module does not depend on ai-assistant.
 *
 * Tool Definition Format:
 * - name: Unique tool identifier (module_action format, no dots allowed)
 * - description: Human-readable description for AI clients
 * - inputSchema: Zod schema for input validation
 * - requiredFeatures: ACL features required to execute
 * - handler: Async function that executes the tool
 */

/**
 * Tool context provided by the MCP server at execution time.
 */
type ToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: {
    resolve: <T = unknown>(name: string) => T
  }
  userFeatures: string[]
  isSuperAdmin: boolean
}

/**
 * Tool definition structure.
 */
type AiToolDefinition = {
  name: string
  description: string
  inputSchema: z.ZodType<any>
  requiredFeatures?: string[]
  handler: (input: any, ctx: ToolContext) => Promise<unknown>
}

// =============================================================================
// Tool Definitions
// =============================================================================

const searchQueryTool: AiToolDefinition = {
  name: 'search_query',
  description: `Search across all data in Open Mercato using hybrid search (full-text, semantic, keyword).

⚠️ IMPORTANT: Before using this tool, FIRST call understand_entity for the entity type you're searching.
This helps you understand the entity's fields, relationships, and how results connect to other data.

WORKFLOW:
1. Call understand_entity("Customer") or understand_entity("Product") first
2. Then call search_query with your search term

Searches customers, products, orders, deals, and other entities.`,
  inputSchema: z.object({
    query: z.string().min(1).describe('The search query text'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of results to return (default: 20)'),
    entityTypes: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to specific entity types (e.g., ["customers:customer_person_profile", "catalog:product"])'
      ),
    strategies: z
      .array(z.enum(['fulltext', 'vector', 'tokens']))
      .optional()
      .describe('Specific search strategies to use (default: all available)'),
  }),
  requiredFeatures: ['search.global'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) {
      throw new Error('Tenant context is required for search')
    }

    const searchService = ctx.container.resolve<{
      search: (query: string, options: any) => Promise<SearchResult[]>
    }>('searchService')

    const results = await searchService.search(input.query, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      entityTypes: input.entityTypes,
      strategies: input.strategies as SearchStrategyId[],
      limit: input.limit,
    })

    return {
      query: input.query,
      totalResults: results.length,
      results: results.map((result) => ({
        entityType: result.entityId,
        recordId: result.recordId,
        score: Math.round(result.score * 100) / 100,
        source: result.source,
        title: result.presenter?.title ?? result.recordId,
        subtitle: result.presenter?.subtitle,
        url: result.url,
      })),
    }
  },
}

const searchStatusTool: AiToolDefinition = {
  name: 'search_status',
  description:
    'Get the current status of the search module, including available search strategies and their availability.',
  inputSchema: z.object({}),
  requiredFeatures: ['search.view'],
  handler: async (_input, ctx) => {
    const searchService = ctx.container.resolve<{
      getStrategies: () => Array<{
        id: string
        name: string
        priority: number
        isAvailable: () => Promise<boolean>
      }>
      getDefaultStrategies: () => string[]
    }>('searchService')

    const strategies = searchService.getStrategies()
    const defaultStrategies = searchService.getDefaultStrategies()

    const strategyStatus = await Promise.all(
      strategies.map(async (strategy) => ({
        id: strategy.id,
        name: strategy.name,
        priority: strategy.priority,
        isAvailable: await strategy.isAvailable(),
        isDefault: defaultStrategies.includes(strategy.id),
      }))
    )

    return {
      strategiesRegistered: strategies.length,
      defaultStrategies,
      strategies: strategyStatus,
    }
  },
}

// =============================================================================
// search.get - Retrieve full record details by entity type and ID
// =============================================================================

const searchGetTool: AiToolDefinition = {
  name: 'search_get',
  description: `Retrieve full record details by entity type and record ID.

⚠️ TIP: If you need to understand the entity's relationships (what other data connects to this record),
call understand_entity first to see the full relationship graph.

Use this after search_query to get complete data for a specific record.`,
  inputSchema: z.object({
    entityType: z
      .string()
      .describe('The entity type (e.g., "customers:customer_company_profile", "customers:customer_deal")'),
    recordId: z.string().describe('The record ID (UUID)'),
  }),
  requiredFeatures: ['search.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) {
      throw new Error('Tenant context is required')
    }

    const queryEngine = ctx.container.resolve<{
      query: (entityId: string, options: any) => Promise<{ items: unknown[]; total: number }>
    }>('queryEngine')

    const result = await queryEngine.query(input.entityType, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      filters: { id: input.recordId },
      includeCustomFields: true,
      page: { page: 1, pageSize: 1 },
    })

    const record = result.items[0] as Record<string, unknown> | undefined
    if (!record) {
      return {
        found: false,
        entityType: input.entityType,
        recordId: input.recordId,
        error: 'Record not found',
      }
    }

    // Extract custom fields
    const customFields: Record<string, unknown> = {}
    const standardFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith('cf:') || key.startsWith('cf_')) {
        customFields[key.replace(/^cf[:_]/, '')] = value
      } else {
        standardFields[key] = value
      }
    }

    // Build URL based on entity type
    let url: string | null = null
    const id = record.id ?? record.entity_id ?? input.recordId
    if (input.entityType.includes('person')) {
      url = `/backend/customers/people/${id}`
    } else if (input.entityType.includes('company')) {
      url = `/backend/customers/companies/${id}`
    } else if (input.entityType.includes('deal')) {
      url = `/backend/customers/deals/${id}`
    } else if (input.entityType.includes('activity')) {
      const entityId = record.entity_id ?? record.entityId
      url = entityId ? `/backend/customers/companies/${entityId}#activity-${id}` : null
    }

    return {
      found: true,
      entityType: input.entityType,
      recordId: input.recordId,
      record: standardFields,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
      url,
    }
  },
}

// =============================================================================
// search.schema - Discover searchable entities and their fields
// =============================================================================

const searchSchemaTool: AiToolDefinition = {
  name: 'search_schema',
  description:
    'Discover searchable entities and their fields. Use this to learn what data can be searched and what fields are available for filtering.',
  inputSchema: z.object({
    entityType: z
      .string()
      .optional()
      .describe('Optional: Get schema for a specific entity type only'),
  }),
  requiredFeatures: ['search.view'],
  handler: async (input, ctx) => {
    const searchIndexer = ctx.container.resolve<{
      getAllEntityConfigs: () => Array<{
        entityId: string
        enabled?: boolean
        priority?: number
        strategies?: string[]
        fieldPolicy?: {
          searchable?: string[]
          hashOnly?: string[]
          excluded?: string[]
        }
      }>
    }>('searchIndexer')

    const allConfigs = searchIndexer.getAllEntityConfigs()
    const entities: Array<{
      entityId: string
      enabled: boolean
      priority: number
      strategies?: string[]
      searchableFields?: string[]
      hashOnlyFields?: string[]
      excludedFields?: string[]
    }> = []

    for (const entityConfig of allConfigs) {
      if (input.entityType && entityConfig.entityId !== input.entityType) {
        continue
      }

      entities.push({
        entityId: entityConfig.entityId,
        enabled: entityConfig.enabled !== false,
        priority: entityConfig.priority ?? 5,
        strategies: entityConfig.strategies,
        searchableFields: entityConfig.fieldPolicy?.searchable,
        hashOnlyFields: entityConfig.fieldPolicy?.hashOnly,
        excludedFields: entityConfig.fieldPolicy?.excluded,
      })
    }

    if (input.entityType && entities.length === 0) {
      return {
        found: false,
        entityType: input.entityType,
        error: 'Entity type not configured for search',
      }
    }

    return {
      totalEntities: entities.length,
      entities: entities.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
    }
  },
}

// =============================================================================
// search.aggregate - Get counts grouped by field values
// =============================================================================

const searchAggregateTool: AiToolDefinition = {
  name: 'search_aggregate',
  description:
    'Get record counts grouped by a field value. Useful for analytics like "how many deals by stage?" or "customers by status".',
  inputSchema: z.object({
    entityType: z
      .string()
      .describe('The entity type to aggregate (e.g., "customers:customer_deal")'),
    groupBy: z
      .string()
      .describe('The field to group by (e.g., "status", "industry", "pipeline_stage")'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of buckets to return (default: 20)'),
  }),
  requiredFeatures: ['search.view'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) {
      throw new Error('Tenant context is required')
    }

    const queryEngine = ctx.container.resolve<{
      query: (entityId: string, options: any) => Promise<{ items: unknown[]; total: number }>
    }>('queryEngine')

    // Fetch records and aggregate in memory
    // Note: For large datasets, this should use database GROUP BY
    const result = await queryEngine.query(input.entityType, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      page: { page: 1, pageSize: 1000 }, // Fetch up to 1000 for aggregation
    })

    const counts = new Map<string | null, number>()
    for (const item of result.items as Record<string, unknown>[]) {
      const value = item[input.groupBy]
      const key = value === null || value === undefined ? null : String(value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    const total = result.items.length
    const buckets = Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        count,
        percentage: Math.round((count / total) * 100 * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, input.limit)

    return {
      entityType: input.entityType,
      groupBy: input.groupBy,
      total,
      buckets,
    }
  },
}

const searchReindexTool: AiToolDefinition = {
  name: 'search_reindex',
  description:
    'Trigger a reindex operation for search data. This rebuilds the search index for the specified entity type or all entities.',
  inputSchema: z.object({
    entityType: z
      .string()
      .optional()
      .describe(
        'Specific entity type to reindex (e.g., "customers:customer_person_profile"). If not provided, reindexes all entities.'
      ),
    strategy: z
      .enum(['fulltext', 'vector'])
      .optional()
      .default('fulltext')
      .describe('Which search strategy to reindex (default: fulltext)'),
    recreateIndex: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to recreate the index from scratch (default: false)'),
  }),
  requiredFeatures: ['search.reindex'],
  handler: async (input, ctx) => {
    if (!ctx.tenantId) {
      throw new Error('Tenant context is required for reindex')
    }

    const searchIndexer = ctx.container.resolve<{
      reindexEntityToFulltext: (params: any) => Promise<any>
      reindexAllToFulltext: (params: any) => Promise<any>
      reindexEntityToVector: (params: any) => Promise<void>
      reindexAllToVector: (params: any) => Promise<void>
    }>('searchIndexer')

    const baseParams = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      recreateIndex: input.recreateIndex,
      useQueue: true,
    }

    if (input.strategy === 'vector') {
      if (input.entityType) {
        await searchIndexer.reindexEntityToVector({
          ...baseParams,
          entityId: input.entityType,
        })
        return {
          status: 'started',
          strategy: 'vector',
          entityType: input.entityType,
          message: `Vector reindex started for ${input.entityType}`,
        }
      } else {
        await searchIndexer.reindexAllToVector(baseParams)
        return {
          status: 'started',
          strategy: 'vector',
          entityType: 'all',
          message: 'Vector reindex started for all entities',
        }
      }
    } else {
      if (input.entityType) {
        const result = await searchIndexer.reindexEntityToFulltext({
          ...baseParams,
          entityId: input.entityType,
        })
        return {
          status: 'completed',
          strategy: 'fulltext',
          entityType: input.entityType,
          ...result,
        }
      } else {
        const result = await searchIndexer.reindexAllToFulltext(baseParams)
        return {
          status: 'completed',
          strategy: 'fulltext',
          entityType: 'all',
          ...result,
        }
      }
    }
  },
}

// =============================================================================
// Export
// =============================================================================

/**
 * All AI tools exported by the search module.
 * Discovered by ai-assistant module's generator.
 */
export const aiTools = [
  searchQueryTool,
  searchStatusTool,
  searchGetTool,
  searchSchemaTool,
  searchAggregateTool,
  searchReindexTool,
]

export default aiTools
