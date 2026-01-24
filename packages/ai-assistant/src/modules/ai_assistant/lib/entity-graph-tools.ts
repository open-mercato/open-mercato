/**
 * Entity Graph MCP Tools
 *
 * Unified tools for AI to understand database entities and their API endpoints.
 *
 * 2 tools total:
 * - understand_entity: Full context for ONE entity (fields + relationships + endpoints) - USE THIS FIRST!
 * - list_entities: High-level discovery (list entities, stats, relationship graph)
 */

import { z } from 'zod'
import type { McpToolDefinition, McpToolContext } from './types'
import {
  getCachedEntityGraph,
  getEntityFields,
  listEntitiesByModule,
  getEntityRelationships,
  formatTriple,
  getGraphStats,
  entityNameToApiPath,
  formatGraphAsTriples,
  filterGraphByModule,
} from './entity-graph'
import { findEndpointsForEntity, simplifyRequestBodySchema } from './api-endpoint-index'

/**
 * Input types for the tools
 */
type EntityContextInput = {
  entity: string
}

type SchemaOverviewInput = {
  module?: string
  includeGraph?: boolean
  graphLimit?: number
}

/**
 * understand_entity - Get full context for ONE entity. USE THIS FIRST before any CRUD operation!
 *
 * Returns:
 * - Entity fields (columns) with types
 * - Relationships (both outgoing and incoming) as triples
 * - API endpoints (CRUD operations with operationIds)
 */
const entityContextTool: McpToolDefinition = {
  name: 'understand_entity',
  description: `🔴 MANDATORY: Call this tool FIRST before ANY data operation!

You MUST call this tool BEFORE:
- Searching for records (before search_query)
- Listing records
- Creating new records
- Updating existing records
- Deleting records
- Exploring relationships

This tool tells you what fields exist, what's required, how entities relate, and the exact API endpoints.

WORKFLOW:
1. User asks about an entity -> call understand_entity FIRST
2. See fields, relationships, and endpoints
3. THEN use search_query, call_api, or other tools

OUTPUT:
- entity.searchEntityId: USE THIS value for search_query entityTypes parameter (e.g., "customers:customer_person_profile")
- entity.fields: List of fields like "fieldName: type" or "fieldName?: type" (? = nullable)
- relationships: How this entity connects to others (e.g., CustomerPerson -> has Deals, belongs to Company)
- endpoints: The exact API paths for list/create/get/update/delete

EXAMPLE:
User: "Find all customers"
1. understand_entity("CustomerCompanyProfile") -> see relationships to deals, people, activities
2. search_query("customers") -> now you know the context

User: "What quotes does John have?"
1. understand_entity("CustomerPersonProfile") -> see relationship to quotes
2. search_query("John") -> find the person
3. understand_entity("SalesQuote") -> understand quote structure
4. search for quotes connected to that person`,
  inputSchema: z.object({
    entity: z.string().describe('Entity class name (exact or partial match, e.g., "SalesOrder", "Customer")'),
  }),
  requiredFeatures: [],
  handler: async (rawInput: unknown, _ctx: McpToolContext) => {
    const input = rawInput as EntityContextInput
    const graph = getCachedEntityGraph()

    if (!graph) {
      return {
        success: false,
        error: 'Entity graph not available. The MCP server may need to be restarted.',
      }
    }

    // Try exact match first
    let entity = getEntityFields(graph, input.entity)

    // If no exact match, try partial match
    if (!entity) {
      const lowerInput = input.entity.toLowerCase()
      entity = graph.nodes.find((node) => node.className.toLowerCase().includes(lowerInput))
    }

    if (!entity) {
      // Suggest similar entities
      const suggestions = graph.nodes
        .filter((node) => {
          const lowerClass = node.className.toLowerCase()
          const lowerInput = input.entity.toLowerCase()
          return lowerInput.split(/\s+/).some((word) => lowerClass.includes(word))
        })
        .slice(0, 5)
        .map((node) => node.className)

      return {
        success: false,
        error: `Entity "${input.entity}" not found`,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        hint: 'Use list_entities to see all available entities',
      }
    }

    // Get relationships (both directions)
    const { outgoing, incoming } = getEntityRelationships(graph, entity.className)

    // Format relationships as triples
    const relationshipTriples = [
      ...outgoing.map(formatTriple),
      ...incoming.map(formatTriple),
    ]

    // Find API endpoints for this entity
    const endpointResult = await findEndpointsForEntity(
      entity.className,
      entity.tableName,
      entityNameToApiPath(entity.className, entity.tableName)
    )

    // Format endpoints for LLM consumption
    const endpoints: Record<string, {
      method: string
      path: string
      operationId: string
      requiredFields?: string[]
    }> = {}

    if (endpointResult) {
      if (endpointResult.list) {
        endpoints.list = {
          method: endpointResult.list.method,
          path: endpointResult.list.path,
          operationId: endpointResult.list.operationId,
        }
      }
      if (endpointResult.create) {
        const schema = simplifyRequestBodySchema(endpointResult.create.requestBodySchema)
        endpoints.create = {
          method: endpointResult.create.method,
          path: endpointResult.create.path,
          operationId: endpointResult.create.operationId,
          requiredFields: schema?.required,
        }
      }
      if (endpointResult.get) {
        endpoints.get = {
          method: endpointResult.get.method,
          path: endpointResult.get.path,
          operationId: endpointResult.get.operationId,
        }
      }
      if (endpointResult.update) {
        endpoints.update = {
          method: endpointResult.update.method,
          path: endpointResult.update.path,
          operationId: endpointResult.update.operationId,
        }
      }
      if (endpointResult.delete) {
        endpoints.delete = {
          method: endpointResult.delete.method,
          path: endpointResult.delete.path,
          operationId: endpointResult.delete.operationId,
        }
      }
    }

    // Format fields compactly: "fieldName: type" or "fieldName?: type" for nullable
    const compactFields = entity.properties.map((prop) => {
      const nullable = prop.nullable ? '?' : ''
      return `${prop.name}${nullable}: ${prop.type}`
    })

    // Derive search entity ID from class name
    // e.g., CustomerPersonProfile -> customers:customer_person_profile
    const modulePrefix = entity.tableName.split('_')[0] || 'core'
    const moduleName = modulePrefix === 'customer' ? 'customers' :
                       modulePrefix === 'sale' ? 'sales' :
                       modulePrefix === 'catalog' ? 'catalog' : modulePrefix

    // Convert PascalCase to snake_case for entity ID
    const snakeCaseEntity = entity.className
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .slice(1) // Remove leading underscore
    const searchEntityId = `${moduleName}:${snakeCaseEntity}`

    return {
      success: true,
      entity: {
        className: entity.className,
        tableName: entity.tableName,
        module: moduleName,
        searchEntityId, // e.g., "customers:customer_person_profile" - USE THIS for search_query entityTypes
        fields: compactFields,
      },
      relationships: relationshipTriples,
      endpoints: Object.keys(endpoints).length > 0 ? endpoints : null,
      hint: !endpointResult
        ? 'No matching API endpoints found. Use find_api to search for endpoints.'
        : undefined,
    }
  },
}

/**
 * list_entities - High-level discovery of entities and relationships.
 *
 * Use for:
 * - Discovering what entities exist in a module
 * - Getting a bird's eye view of the data model
 * - Finding all entities before drilling into specifics
 */
const schemaOverviewTool: McpToolDefinition = {
  name: 'list_entities',
  description: `List all available entities in the system, grouped by module.

USE THIS TOOL when you need to:
- See what data types/entities exist (Company, Person, SalesOrder, Product, etc.)
- Explore a specific module (sales, customers, catalog)
- Find the correct entity name before using understand_entity

OUTPUT:
- stats: Total entity count and list of modules
- entities: Entity names grouped by module
- graph: How entities relate (optional)

EXAMPLES:
- See all modules: { }
- Customer entities: { "module": "customers" }
- Sales with relationships: { "module": "sales", "includeGraph": true }`,
  inputSchema: z.object({
    module: z.string().optional().describe('Filter to a specific module (e.g., "sales", "customers")'),
    includeGraph: z.boolean().optional().default(false).describe('Include relationship triples'),
    graphLimit: z.number().optional().default(50).describe('Max relationship triples to return (default: 50)'),
  }),
  requiredFeatures: [],
  handler: async (rawInput: unknown, _ctx: McpToolContext) => {
    const input = rawInput as SchemaOverviewInput
    const graph = getCachedEntityGraph()

    if (!graph) {
      return {
        success: false,
        error: 'Entity graph not available. The MCP server may need to be restarted.',
      }
    }

    // Get stats
    const stats = getGraphStats(graph)

    // Get entities by module
    const byModule = listEntitiesByModule(graph)

    // Convert to object for JSON serialization
    let entitiesResult: Record<string, string[]> = {}
    for (const [module, entities] of byModule.entries()) {
      entitiesResult[module] = entities.sort()
    }

    // Filter to specific module if requested
    if (input.module) {
      const lowerModule = input.module.toLowerCase()
      const matchingModule = Object.keys(entitiesResult).find((m) => m.toLowerCase().includes(lowerModule))

      if (matchingModule) {
        entitiesResult = { [matchingModule]: entitiesResult[matchingModule] }
      } else {
        return {
          success: false,
          error: `Module "${input.module}" not found`,
          availableModules: stats.modules,
        }
      }
    }

    // Build result
    const result: Record<string, unknown> = {
      success: true,
      stats,
      entities: entitiesResult,
    }

    // Include graph if requested
    if (input.includeGraph) {
      let edges = graph.edges

      // Filter by module if specified
      if (input.module) {
        edges = filterGraphByModule(graph, input.module)
      }

      // Apply limit
      const limit = input.graphLimit ?? 50
      const limitedEdges = edges.slice(0, limit)

      result.graph = formatGraphAsTriples({ ...graph, edges: limitedEdges })

      if (edges.length > limit) {
        result.graphHint = `Showing ${limit} of ${edges.length} relationships. Filter by module for fewer results.`
      }
    }

    return result
  },
}

/**
 * All entity graph tools for registration.
 */
export const entityGraphTools: McpToolDefinition[] = [
  entityContextTool,
  schemaOverviewTool,
]
