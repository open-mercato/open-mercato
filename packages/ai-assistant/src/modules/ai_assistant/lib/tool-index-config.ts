import type {
  SearchEntityConfig,
  SearchResultPresenter,
  IndexableRecord,
} from '@open-mercato/search/types'
import type { McpToolDefinition } from './types'

/**
 * Entity ID for MCP tools in the search index.
 * Following the module:entity naming convention.
 */
export const TOOL_ENTITY_ID = 'ai_assistant:mcp_tool' as const

/**
 * Synthetic tenant ID for global tools.
 * Tools are not tenant-scoped, but the search system requires a tenant.
 */
export const GLOBAL_TENANT_ID = '__global__' as const

/**
 * Essential tools that should always be available regardless of search results.
 * These provide fundamental functionality for the AI assistant.
 */
export const ESSENTIAL_TOOLS = [
  'context_whoami', // Auth context awareness
  'search_query', // Universal search
  'search_schema', // Entity discovery
  'search_status', // Check integrations
] as const

/**
 * Default configuration for tool search.
 */
export const TOOL_SEARCH_CONFIG = {
  /** Maximum tools to return from search */
  defaultLimit: 12,
  /** Minimum relevance score (0-1) */
  minScore: 0.2,
  /** Strategies to use (in priority order) */
  strategies: ['fulltext', 'vector', 'tokens'] as const,
} as const

/**
 * Search entity configuration for MCP tools.
 * This configures how tools are indexed and searched.
 */
export const toolSearchEntityConfig: SearchEntityConfig = {
  entityId: TOOL_ENTITY_ID,
  enabled: true,
  priority: 100, // High priority for tool results

  /**
   * Build searchable content from a tool definition.
   */
  buildSource: (ctx) => {
    const tool = ctx.record as unknown as McpToolDefinition
    const name = tool.name || ''
    const description = tool.description || ''
    const moduleId = (ctx.record as Record<string, unknown>).moduleId as string | undefined

    // Normalize name: replace underscores/dots with spaces for better search
    const normalizedName = name.replace(/[_.-]/g, ' ')

    // Build text content for embedding and fulltext search
    const textContent = [
      normalizedName,
      description,
      moduleId ? `module ${moduleId}` : '',
    ]
      .filter(Boolean)
      .join(' | ')

    return {
      text: textContent,
      fields: {
        name: normalizedName,
        originalName: name,
        description,
        moduleId: moduleId ?? null,
        requiredFeatures: tool.requiredFeatures ?? [],
      },
      presenter: {
        title: name,
        subtitle: description.slice(0, 100),
        icon: 'tool',
      },
      checksumSource: { name, description, moduleId },
    }
  },

  /**
   * Format result for display in search UI.
   */
  formatResult: (ctx) => {
    const tool = ctx.record as unknown as McpToolDefinition
    return {
      title: tool.name || 'Unknown Tool',
      subtitle: (tool.description || '').slice(0, 100),
      icon: 'tool',
    }
  },

  /**
   * Field policy for search strategies.
   */
  fieldPolicy: {
    searchable: ['name', 'description', 'moduleId'],
    hashOnly: [],
    excluded: ['requiredFeatures', 'inputSchema', 'handler'],
  },
}

/**
 * Convert an MCP tool definition to an indexable record for search.
 *
 * @param tool - The tool definition to index
 * @param moduleId - The module that registered this tool
 * @returns IndexableRecord ready for search indexing
 */
export function toolToIndexableRecord(
  tool: McpToolDefinition,
  moduleId?: string
): IndexableRecord {
  const normalizedName = tool.name.replace(/[_.-]/g, ' ')
  const description = tool.description || ''

  // Build text for vector embedding
  const embeddingText = `${normalizedName} | ${description}`

  const presenter: SearchResultPresenter = {
    title: tool.name,
    subtitle: description.slice(0, 100),
    icon: 'tool',
  }

  return {
    entityId: TOOL_ENTITY_ID,
    recordId: tool.name,
    tenantId: GLOBAL_TENANT_ID,
    organizationId: null,
    fields: {
      name: normalizedName,
      originalName: tool.name,
      description,
      moduleId: moduleId ?? null,
      requiredFeatures: tool.requiredFeatures ?? [],
    },
    presenter,
    text: embeddingText,
    checksumSource: {
      name: tool.name,
      description,
      moduleId,
    },
  }
}

/**
 * Compute a simple checksum for tool definitions.
 * Used to detect changes and avoid unnecessary re-indexing.
 */
export function computeToolsChecksum(
  tools: Array<{ name: string; description: string }>
): string {
  const content = tools
    .map((t) => `${t.name}:${t.description}`)
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
