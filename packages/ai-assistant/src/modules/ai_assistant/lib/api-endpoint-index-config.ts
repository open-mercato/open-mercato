import type {
  SearchEntityConfig,
  SearchResultPresenter,
  IndexableRecord,
} from '@open-mercato/search/types'
import type { ApiEndpoint } from './api-endpoint-index'

/**
 * Entity ID for API endpoints in the search index.
 * Following the module:entity naming convention.
 */
export const API_ENDPOINT_ENTITY_ID = 'ai_assistant:api_endpoint' as const

/**
 * Synthetic tenant ID for global endpoints.
 * API endpoints are not tenant-scoped, but the search system requires a tenant.
 */
export const GLOBAL_TENANT_ID = '__global__' as const

/**
 * Default configuration for API endpoint search.
 */
export const API_ENDPOINT_SEARCH_CONFIG = {
  /** Maximum endpoints to return from search */
  defaultLimit: 20,
  /** Minimum relevance score (0-1) */
  minScore: 0.15,
  /** Strategies to use (in priority order) */
  strategies: ['fulltext', 'vector'] as const,
} as const

/**
 * Search entity configuration for API endpoints.
 * This configures how endpoints are indexed and searched.
 */
export const apiEndpointEntityConfig: SearchEntityConfig = {
  entityId: API_ENDPOINT_ENTITY_ID,
  enabled: true,
  priority: 90, // High priority, just below tools

  /**
   * Build searchable content from an API endpoint.
   */
  buildSource: (ctx) => {
    const endpoint = ctx.record as unknown as ApiEndpoint
    const method = endpoint.method || ''
    const path = endpoint.path || ''
    const summary = endpoint.summary || ''
    const description = endpoint.description || ''
    const tags = endpoint.tags || []
    const operationId = endpoint.operationId || ''

    // Normalize path: replace slashes and braces with spaces for better search
    const normalizedPath = path.replace(/[/{}\[\]]/g, ' ').trim()

    // Build action words from method
    const actionWords = getActionWordsForMethod(method)

    // Build text content for embedding and fulltext search
    const textContent = [
      `${method} ${normalizedPath}`,
      operationId.replace(/[_.-]/g, ' '),
      summary,
      description,
      ...actionWords,
      ...tags,
    ]
      .filter(Boolean)
      .join(' | ')

    return {
      text: textContent,
      fields: {
        method,
        path,
        operationId,
        summary,
        description,
        tags,
        module: extractModuleFromPath(path),
        deprecated: endpoint.deprecated ?? false,
        requiredFeatures: endpoint.requiredFeatures ?? [],
      },
      presenter: {
        title: `${method} ${path}`,
        subtitle: summary || description.slice(0, 100),
        icon: getIconForMethod(method),
      },
      checksumSource: { operationId, method, path, summary },
    }
  },

  /**
   * Format result for display in search UI.
   */
  formatResult: (ctx) => {
    const endpoint = ctx.record as unknown as ApiEndpoint
    return {
      title: `${endpoint.method} ${endpoint.path}`,
      subtitle: (endpoint.summary || endpoint.description || '').slice(0, 100),
      icon: getIconForMethod(endpoint.method),
    }
  },

  /**
   * Field policy for search strategies.
   */
  fieldPolicy: {
    searchable: ['method', 'path', 'operationId', 'summary', 'description', 'tags', 'module'],
    hashOnly: [],
    excluded: ['parameters', 'requestBodySchema', 'requiredFeatures'],
  },
}

/**
 * Convert an API endpoint to an indexable record for search.
 *
 * @param endpoint - The API endpoint to index
 * @returns IndexableRecord ready for search indexing
 */
export function endpointToIndexableRecord(endpoint: ApiEndpoint): IndexableRecord {
  const method = endpoint.method
  const path = endpoint.path
  const normalizedPath = path.replace(/[/{}\[\]]/g, ' ').trim()
  const actionWords = getActionWordsForMethod(method)

  // Build text for vector embedding
  const embeddingText = [
    `${method} ${normalizedPath}`,
    endpoint.operationId.replace(/[_.-]/g, ' '),
    endpoint.summary,
    endpoint.description,
    ...actionWords,
    ...endpoint.tags,
  ]
    .filter(Boolean)
    .join(' | ')

  const presenter: SearchResultPresenter = {
    title: `${method} ${path}`,
    subtitle: (endpoint.summary || endpoint.description || '').slice(0, 100),
    icon: getIconForMethod(method),
  }

  return {
    entityId: API_ENDPOINT_ENTITY_ID,
    recordId: endpoint.operationId,
    tenantId: GLOBAL_TENANT_ID,
    organizationId: null,
    fields: {
      method,
      path,
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      description: endpoint.description,
      tags: endpoint.tags,
      module: extractModuleFromPath(path),
      deprecated: endpoint.deprecated,
      requiredFeatures: endpoint.requiredFeatures,
    },
    presenter,
    text: embeddingText,
    checksumSource: {
      operationId: endpoint.operationId,
      method,
      path,
      summary: endpoint.summary,
    },
  }
}

/**
 * Get action words for HTTP method to improve semantic search.
 */
function getActionWordsForMethod(method: string): string[] {
  switch (method.toUpperCase()) {
    case 'GET':
      return ['read', 'fetch', 'get', 'list', 'retrieve', 'find', 'search', 'query']
    case 'POST':
      return ['create', 'add', 'new', 'insert', 'submit', 'register']
    case 'PUT':
      return ['update', 'replace', 'modify', 'set', 'change', 'edit']
    case 'PATCH':
      return ['update', 'modify', 'partial', 'change', 'edit', 'patch']
    case 'DELETE':
      return ['delete', 'remove', 'destroy', 'cancel', 'erase']
    default:
      return []
  }
}

/**
 * Get icon for HTTP method.
 */
function getIconForMethod(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'search'
    case 'POST':
      return 'plus'
    case 'PUT':
    case 'PATCH':
      return 'edit'
    case 'DELETE':
      return 'trash'
    default:
      return 'api'
  }
}

/**
 * Extract module name from API path.
 */
function extractModuleFromPath(path: string): string | null {
  // Common module patterns in paths
  const match = path.match(/^\/([\w-]+)/)
  if (match) {
    return match[1]
  }
  return null
}

/**
 * Compute a simple checksum for endpoint definitions.
 * Used to detect changes and avoid unnecessary re-indexing.
 */
export function computeEndpointsChecksum(
  endpoints: Array<{ operationId: string; method: string; path: string }>
): string {
  const content = endpoints
    .map((e) => `${e.operationId}:${e.method}:${e.path}`)
    .sort()
    .join('|')

  // Simple hash using string code points
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return hash.toString(16)
}
