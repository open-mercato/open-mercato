/**
 * General-purpose `search.*` tool pack (Phase 1 WS-C, Step 3.8).
 *
 * These tools are discovered by the generator alongside any other module
 * `ai-tools.ts`; they expose the existing `@open-mercato/search` runtime to
 * agents that whitelist them via `allowedTools`.
 */
import { z } from 'zod'
import type { SearchOptions, SearchResult, SearchStrategyId } from '@open-mercato/shared/modules/search'
import { defineAiTool } from '../lib/ai-tool-definition'
import type { AiToolDefinition } from '../lib/types'

type SearchServiceLike = {
  search: (query: string, options: SearchOptions) => Promise<SearchResult[]>
}

const hybridSearchInput = z.object({
  q: z.string().min(1).describe('Search query text.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum results (default 20, max 100).'),
  strategies: z
    .array(z.enum(['fulltext', 'vector', 'tokens']))
    .optional()
    .describe('Subset of strategies to run; defaults to the module defaults.'),
  entityTypes: z
    .array(z.string())
    .optional()
    .describe('Filter to specific entity ids (e.g. "catalog:product").'),
})

const hybridSearchTool: AiToolDefinition = defineAiTool({
  name: 'search.hybrid_search',
  displayName: 'Hybrid search',
  description:
    'Run a global fulltext + vector + token search across enabled entities for the current tenant/organization.',
  inputSchema: hybridSearchInput,
  requiredFeatures: ['search.view'],
  tags: ['read', 'search'],
  handler: async (rawInput, ctx) => {
    if (!ctx.tenantId) {
      throw new Error('Tenant context is required for search.hybrid_search')
    }
    const input = hybridSearchInput.parse(rawInput)
    const service = ctx.container.resolve<SearchServiceLike>('searchService')
    const limit = input.limit ?? 20
    const started = Date.now()
    const results = await service.search(input.q, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      limit,
      strategies: input.strategies as SearchStrategyId[] | undefined,
      entityTypes: input.entityTypes,
    })
    const timingMs = Date.now() - started
    const strategiesUsed = Array.from(
      new Set(results.map((result) => result.source).filter((id): id is string => typeof id === 'string')),
    )
    return {
      query: input.q,
      totalResults: results.length,
      results,
      strategiesUsed,
      timing: { ms: timingMs },
    }
  },
})

const getRecordContextInput = z.object({
  entityId: z.string().min(1).describe('Entity identifier (e.g. "customers:customer_person_profile").'),
  recordId: z.string().min(1).describe('Record primary key (UUID).'),
})

const getRecordContextTool: AiToolDefinition = defineAiTool({
  name: 'search.get_record_context',
  displayName: 'Get record context',
  description:
    'Resolve presenter, links, and URL for a specific record by re-querying the search index. Returns { found: false } when no hit matches the recordId.',
  inputSchema: getRecordContextInput,
  requiredFeatures: ['search.view'],
  tags: ['read', 'search'],
  handler: async (rawInput, ctx) => {
    if (!ctx.tenantId) {
      throw new Error('Tenant context is required for search.get_record_context')
    }
    const input = getRecordContextInput.parse(rawInput)
    const service = ctx.container.resolve<SearchServiceLike>('searchService')
    const results = await service.search(input.recordId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      limit: 5,
      entityTypes: [input.entityId],
    })
    const match = results.find((result) => result.recordId === input.recordId)
    if (!match) {
      return {
        found: false as const,
        entityId: input.entityId,
        recordId: input.recordId,
      }
    }
    return {
      found: true as const,
      entityId: match.entityId,
      recordId: match.recordId,
      presenter: match.presenter,
      url: match.url,
      links: match.links,
      metadata: match.metadata,
      source: match.source,
      score: match.score,
    }
  },
})

export const searchAiTools: AiToolDefinition[] = [hybridSearchTool, getRecordContextTool]

export default searchAiTools
