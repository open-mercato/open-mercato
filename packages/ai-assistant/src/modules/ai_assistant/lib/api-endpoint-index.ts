/**
 * API Endpoint Index
 *
 * Parses OpenAPI spec and indexes endpoints for discovery via hybrid search.
 */

import { buildOpenApiDocument, sanitizeOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { SearchService } from '@open-mercato/search/service'

/**
 * Indexed API endpoint structure
 */
export interface ApiEndpoint {
  id: string
  operationId: string
  method: string
  path: string
  summary: string
  description: string
  tags: string[]
  requiredFeatures: string[]
  parameters: ApiParameter[]
  requestBodySchema: Record<string, unknown> | null
  deprecated: boolean
}

export interface ApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  type: string
  description: string
}

/**
 * Entity type for API endpoints in search index
 */
export const API_ENDPOINT_ENTITY = 'api_endpoint'

/**
 * In-memory cache of parsed endpoints (avoid re-parsing on each request)
 */
let endpointsCache: ApiEndpoint[] | null = null
let endpointsByOperationId: Map<string, ApiEndpoint> | null = null

/**
 * Get all parsed API endpoints (cached)
 */
export async function getApiEndpoints(): Promise<ApiEndpoint[]> {
  if (endpointsCache) {
    return endpointsCache
  }

  endpointsCache = await parseApiEndpoints()
  endpointsByOperationId = new Map(endpointsCache.map((e) => [e.operationId, e]))

  return endpointsCache
}

/**
 * Get endpoint by operationId
 */
export async function getEndpointByOperationId(operationId: string): Promise<ApiEndpoint | null> {
  await getApiEndpoints() // Ensure cache is populated
  return endpointsByOperationId?.get(operationId) ?? null
}

/**
 * Parse OpenAPI spec into indexable endpoints
 */
async function parseApiEndpoints(): Promise<ApiEndpoint[]> {
  // Import modules dynamically to avoid circular dependencies
  let modules: unknown
  try {
    const modulesImport = await import('@/generated/modules.generated')
    modules = modulesImport.modules
  } catch (error) {
    console.error('[API Index] Could not import modules.generated:', error)
    return []
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  const rawDoc = buildOpenApiDocument(modules as any, {
    title: 'Open Mercato API',
    version: '1.0.0',
    servers: [{ url: baseUrl }],
    baseUrlForExamples: baseUrl,
  })
  const doc = sanitizeOpenApiDocument(rawDoc) as OpenApiDocument

  return extractEndpoints(doc)
}

/**
 * Extract endpoints from OpenAPI document
 */
function extractEndpoints(doc: OpenApiDocument): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = []
  const validMethods = ['get', 'post', 'put', 'patch', 'delete']

  if (!doc.paths) {
    return endpoints
  }

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!validMethods.includes(method.toLowerCase())) continue
      if (!operation || typeof operation !== 'object') continue

      const op = operation as any

      // Generate operationId if not present
      const operationId = op.operationId || generateOperationId(path, method)

      const endpoint: ApiEndpoint = {
        id: operationId,
        operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary || '',
        description: op.description || op.summary || `${method.toUpperCase()} ${path}`,
        tags: op.tags || [],
        requiredFeatures: op['x-require-features'] || [],
        deprecated: op.deprecated || false,
        parameters: extractParameters(op.parameters || []),
        requestBodySchema: extractRequestBodySchema(op.requestBody, doc.components?.schemas),
      }

      endpoints.push(endpoint)
    }
  }

  console.error(`[API Index] Parsed ${endpoints.length} endpoints from OpenAPI spec`)
  return endpoints
}

/**
 * Generate operationId from path and method
 */
function generateOperationId(path: string, method: string): string {
  const pathParts = path
    .replace(/^\//, '')
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .split('/')
    .filter(Boolean)
    .join('_')

  return `${method.toLowerCase()}_${pathParts}`
}

/**
 * Extract parameter info
 */
function extractParameters(params: any[]): ApiParameter[] {
  return params
    .filter((p) => p.in === 'path' || p.in === 'query')
    .map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required ?? false,
      type: p.schema?.type || 'string',
      description: p.description || '',
    }))
}

/**
 * Extract request body schema (simplified)
 */
function extractRequestBodySchema(
  requestBody: any,
  schemas?: Record<string, any>
): Record<string, unknown> | null {
  if (!requestBody?.content?.['application/json']?.schema) {
    return null
  }

  const schema = requestBody.content['application/json'].schema

  // Resolve $ref if present
  if (schema.$ref && schemas) {
    const refPath = schema.$ref.replace('#/components/schemas/', '')
    return schemas[refPath] || schema
  }

  return schema
}

/**
 * Index endpoints for search discovery
 */
export async function indexApiEndpoints(searchService: SearchService): Promise<number> {
  const endpoints = await getApiEndpoints()

  if (endpoints.length === 0) {
    console.error('[API Index] No endpoints to index')
    return 0
  }

  // Convert to indexable records
  const records = endpoints.map((endpoint) => ({
    id: endpoint.id,
    entityType: API_ENDPOINT_ENTITY,
    tenantId: '__global__', // API endpoints are global
    organizationId: null,
    content: buildSearchableContent(endpoint),
    metadata: {
      method: endpoint.method,
      path: endpoint.path,
      tags: endpoint.tags,
      requiredFeatures: endpoint.requiredFeatures,
      deprecated: endpoint.deprecated,
    },
  }))

  try {
    // Use fulltext strategy only for now (most reliable)
    await searchService.bulkIndex(API_ENDPOINT_ENTITY, records as any)
    console.error(`[API Index] Indexed ${records.length} endpoints for search`)
    return records.length
  } catch (error) {
    console.error('[API Index] Failed to index endpoints:', error)
    return 0
  }
}

/**
 * Build searchable content from endpoint
 */
function buildSearchableContent(endpoint: ApiEndpoint): string {
  const parts = [
    endpoint.operationId,
    endpoint.method,
    endpoint.path,
    endpoint.summary,
    endpoint.description,
    ...endpoint.tags,
    ...endpoint.parameters.map((p) => `${p.name} ${p.description}`),
  ]

  return parts.filter(Boolean).join(' ')
}

/**
 * Search endpoints using hybrid search
 */
export async function searchEndpoints(
  searchService: SearchService,
  query: string,
  options: { limit?: number; method?: string } = {}
): Promise<ApiEndpoint[]> {
  const { limit = 10, method } = options

  // Get all endpoints (from cache)
  const allEndpoints = await getApiEndpoints()

  // Simple text matching for now
  // TODO: Use searchService.search() when entity type is properly configured
  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(Boolean)

  let matches = allEndpoints.filter((endpoint) => {
    const content = buildSearchableContent(endpoint).toLowerCase()
    return queryTerms.some((term) => content.includes(term))
  })

  // Filter by method if specified
  if (method) {
    matches = matches.filter((e) => e.method === method.toUpperCase())
  }

  // Sort by relevance (number of matching terms)
  matches.sort((a, b) => {
    const aContent = buildSearchableContent(a).toLowerCase()
    const bContent = buildSearchableContent(b).toLowerCase()
    const aScore = queryTerms.filter((t) => aContent.includes(t)).length
    const bScore = queryTerms.filter((t) => bContent.includes(t)).length
    return bScore - aScore
  })

  return matches.slice(0, limit)
}

/**
 * Clear endpoint cache (for testing)
 */
export function clearEndpointCache(): void {
  endpointsCache = null
  endpointsByOperationId = null
}
