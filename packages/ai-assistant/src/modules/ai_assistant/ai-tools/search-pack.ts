/**
 * General-purpose `search.*` tool pack (Phase 1 WS-C, Step 3.8).
 *
 * These tools are discovered by the generator alongside any other module
 * `ai-tools.ts`; they expose the existing `@open-mercato/search` runtime to
 * agents that whitelist them via `allowedTools`.
 */
import { z } from 'zod'
import type { SearchOptions, SearchResult, SearchStrategyId } from '@open-mercato/shared/modules/search'
import {
  canReadSearchEntity,
  filterSearchResultsByEntityAccess,
  resolveReadableEntityTypes,
  type SearchEntityAccessSubject,
  type SearchEntityConfigLookup,
  type SearchEntityDenyReason,
} from '@open-mercato/shared/lib/search/entityAccess'
import { defineAiTool } from '../lib/ai-tool-definition'
import type { AiToolDefinition, McpToolContext } from '../lib/types'

type SearchServiceLike = {
  search: (query: string, options: SearchOptions) => Promise<SearchResult[]>
}

class SearchToolAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchToolAuthorizationError'
  }
}

function resolveSearchIndexer(ctx: McpToolContext): SearchEntityConfigLookup {
  try {
    const indexer = ctx.container.resolve('searchIndexer') as SearchEntityConfigLookup | undefined
    if (indexer && typeof indexer.getEntityConfig === 'function' && typeof indexer.getAllEntityConfigs === 'function') {
      return indexer
    }
  } catch {
    // fall through to throw
  }
  throw new SearchToolAuthorizationError('[internal] Search entity registry unavailable')
}

function authorizeEntityAccess(
  entityType: string,
  lookup: SearchEntityConfigLookup,
  subject: SearchEntityAccessSubject,
): void {
  if (subject.isSuperAdmin) return
  let denial: SearchEntityDenyReason | undefined
  const allowed = canReadSearchEntity(entityType, lookup, subject, {
    onDeny: (_, reason) => {
      denial = reason
    },
  })
  if (allowed) return
  if (denial === 'unconfigured') {
    throw new SearchToolAuthorizationError(`[internal] Entity type "${entityType}" is not configured for search`)
  }
  if (denial === 'no-acl-features') {
    throw new SearchToolAuthorizationError(
      `[internal] Entity type "${entityType}" does not declare aclFeatures; access denied`,
    )
  }
  const config = lookup.getEntityConfig(entityType)
  const required = config?.aclFeatures ?? []
  throw new SearchToolAuthorizationError(
    `[internal] Insufficient permissions for entity "${entityType}". Required: ${required.join(', ')}`,
  )
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

const hybridSearchTool = defineAiTool({
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
    const subject: SearchEntityAccessSubject = {
      grantedFeatures: ctx.userFeatures,
      isSuperAdmin: ctx.isSuperAdmin,
    }

    if (ctx.isSuperAdmin) {
      const results = await service.search(input.q, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        limit,
        strategies: input.strategies as SearchStrategyId[] | undefined,
        entityTypes: input.entityTypes,
      })
      const timingMs = Date.now() - started
      const strategiesUsed = Array.from(
        new Set(results.map((result) => result.source).filter((id): id is SearchStrategyId => typeof id === 'string')),
      )
      return {
        query: input.q,
        totalResults: results.length,
        results,
        strategiesUsed,
        timing: { ms: timingMs },
      }
    }

    const lookup = resolveSearchIndexer(ctx)
    const readableEntityTypes = resolveReadableEntityTypes(lookup, subject, input.entityTypes)
    if (readableEntityTypes && readableEntityTypes.length === 0) {
      return {
        query: input.q,
        totalResults: 0,
        results: [],
        strategiesUsed: [],
        timing: { ms: Date.now() - started },
      }
    }

    const rawResults = await service.search(input.q, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      limit,
      strategies: input.strategies as SearchStrategyId[] | undefined,
      entityTypes: readableEntityTypes,
    })
    const results = filterSearchResultsByEntityAccess(rawResults, lookup, subject)
    const timingMs = Date.now() - started
    const strategiesUsed = Array.from(
      new Set(results.map((result) => result.source).filter((id): id is SearchStrategyId => typeof id === 'string')),
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

const getRecordContextTool = defineAiTool({
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
    const subject: SearchEntityAccessSubject = {
      grantedFeatures: ctx.userFeatures,
      isSuperAdmin: ctx.isSuperAdmin,
    }

    let lookup: SearchEntityConfigLookup | undefined
    if (!ctx.isSuperAdmin) {
      lookup = resolveSearchIndexer(ctx)
      authorizeEntityAccess(input.entityId, lookup, subject)
    }

    const service = ctx.container.resolve<SearchServiceLike>('searchService')
    const rawResults = await service.search(input.recordId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      limit: 5,
      entityTypes: [input.entityId],
    })
    const results = lookup ? filterSearchResultsByEntityAccess(rawResults, lookup, subject) : rawResults
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

export const searchAiTools: AiToolDefinition<any, any>[] = [hybridSearchTool, getRecordContextTool]

export default searchAiTools
