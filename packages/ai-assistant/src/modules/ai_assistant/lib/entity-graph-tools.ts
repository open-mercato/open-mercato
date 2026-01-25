/**
 * Entity Graph MCP Tools
 *
 * Unified tool for AI to discover database entity schemas via Meilisearch search.
 *
 * 1 tool:
 * - discover_schema: Search for entity schemas by name or keyword
 */

import { z } from 'zod'
import type { McpToolDefinition, McpToolContext } from './types'
import type { SearchService } from '@open-mercato/search/service'
import {
  getCachedEntityGraph,
  inferModuleFromEntity,
  type EntityGraph,
  type EntityNode,
} from './entity-graph'
import {
  ENTITY_SCHEMA_ENTITY_ID,
  GLOBAL_TENANT_ID,
  ENTITY_SCHEMA_SEARCH_CONFIG,
} from './entity-index-config'

/**
 * Build entity schema result from cached graph node.
 */
function buildEntityResult(graph: EntityGraph, node: EntityNode) {
  // Find all outgoing relationships for this entity
  const relationships = graph.edges
    .filter((edge) => edge.source === node.className)
    .map((edge) => ({
      relationship: edge.relationship,
      target: edge.target,
      property: edge.property,
      nullable: edge.nullable,
    }))

  return {
    className: node.className,
    tableName: node.tableName,
    module: inferModuleFromEntity(node.className, node.tableName),
    fields: node.properties,
    relationships,
  }
}

/**
 * discover_schema - Search for entity schemas by name or keyword.
 *
 * Returns: className, tableName, module, fields with types, relationships.
 *
 * This tool uses Meilisearch hybrid search (fulltext + vector) to find
 * relevant entity schemas based on the query, then looks up full schema
 * from the cached entity graph.
 */
const discoverSchemaTool: McpToolDefinition = {
  name: 'discover_schema',
  description: `Search for database entity schemas by name or keyword.

Returns entity schema with: className, tableName, module, fields with types, relationships.

Examples:
- discover_schema({ query: "Company" }) → CustomerCompanyProfile schema
- discover_schema({ query: "sales order" }) → SalesOrder schema
- discover_schema({ query: "customer" }) → all customer-related entities

Use this tool to understand what data structures exist before making API calls.`,
  inputSchema: z.object({
    query: z.string().describe('Entity name or keyword to search (e.g., "Company", "sales order", "customer")'),
    limit: z.number().optional().default(5).describe('Maximum number of results to return (default: 5)'),
  }),
  requiredFeatures: [],
  handler: async (rawInput: unknown, ctx: McpToolContext) => {
    const input = rawInput as { query: string; limit?: number }
    const limit = input.limit ?? ENTITY_SCHEMA_SEARCH_CONFIG.defaultLimit

    // Get cached entity graph for full schema lookup
    const graph = getCachedEntityGraph()
    if (!graph) {
      return {
        success: false,
        error: 'Entity graph not available. The MCP server may need to be restarted.',
      }
    }

    // Build entity lookup map by className
    const entityByClassName = new Map<string, EntityNode>()
    for (const node of graph.nodes) {
      entityByClassName.set(node.className, node)
    }

    // Try to get search service for Meilisearch-powered discovery
    let searchService: SearchService | null = null
    try {
      searchService = ctx.container.resolve('searchService') as SearchService
    } catch {
      // Search service not available, fallback to in-memory search
    }

    // Search using Meilisearch if available
    if (searchService) {
      try {
        const results = await searchService.search(input.query, {
          tenantId: GLOBAL_TENANT_ID,
          organizationId: null,
          entityTypes: [ENTITY_SCHEMA_ENTITY_ID],
          limit: limit * 2,
        })

        if (results.length > 0) {
          // Look up full schema from cached graph using recordId (which is className)
          const entities = results
            .slice(0, limit)
            .map((result) => {
              const node = entityByClassName.get(result.recordId)
              if (node) {
                return buildEntityResult(graph, node)
              }
              return null
            })
            .filter((e): e is NonNullable<typeof e> => e !== null)

          if (entities.length > 0) {
            return {
              success: true,
              count: entities.length,
              entities,
            }
          }
        }
        // Fall through to in-memory search if no results
      } catch {
        // Fall through to in-memory search on error
      }
    }

    // Fallback: In-memory fuzzy search on entity names
    const queryLower = input.query.toLowerCase()
    const queryTerms = queryLower.split(/\s+/).filter(Boolean)

    const matches = graph.nodes.filter((node) => {
      const className = node.className.toLowerCase()
      const tableName = node.tableName.toLowerCase()
      const module = inferModuleFromEntity(node.className, node.tableName).toLowerCase()

      // Match any query term against class name, table name, or module
      return queryTerms.some(
        (term) =>
          className.includes(term) ||
          tableName.includes(term) ||
          module.includes(term)
      )
    })

    if (matches.length === 0) {
      // Suggest similar entities
      const suggestions = graph.nodes
        .filter((node) => {
          const className = node.className.toLowerCase()
          return queryTerms.some((term) =>
            className.split(/(?=[A-Z])/).some((part) => part.toLowerCase().includes(term))
          )
        })
        .slice(0, 5)
        .map((node) => node.className)

      return {
        success: false,
        error: `No entities found matching "${input.query}"`,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        hint: 'Try a different search term or use broader keywords like "customer", "sales", "order".',
      }
    }

    // Build results from matches
    const entities = matches.slice(0, limit).map((node) => buildEntityResult(graph, node))

    return {
      success: true,
      count: entities.length,
      entities,
    }
  },
}

/**
 * All entity graph tools for registration.
 */
export const entityGraphTools: McpToolDefinition[] = [
  discoverSchemaTool,
]
