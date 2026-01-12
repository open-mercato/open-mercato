import { z } from 'zod'
import type { SearchResult, SearchStrategyId } from '@open-mercato/shared/modules/search'

/**
 * AI Tools definitions for the Search module.
 *
 * These tool definitions are discovered by the ai-assistant module's generator
 * and registered as MCP tools. The search module does not depend on ai-assistant.
 *
 * Tool Definition Format:
 * - name: Unique tool identifier (module.action format)
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
  name: 'search.query',
  description:
    'Search across all data in Open Mercato. Searches customers, products, orders, and other entities using hybrid search (full-text, semantic, and keyword matching).',
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
  name: 'search.status',
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

const searchReindexTool: AiToolDefinition = {
  name: 'search.reindex',
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
export const aiTools = [searchQueryTool, searchStatusTool, searchReindexTool]

export default aiTools
