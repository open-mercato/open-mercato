import type { SearchService } from '@open-mercato/search/service'
import type { SearchStrategyId, IndexableRecord } from '@open-mercato/search/types'
import type { McpToolRegistry, McpToolDefinition } from './types'
import {
  TOOL_ENTITY_ID,
  GLOBAL_TENANT_ID,
  TOOL_SEARCH_CONFIG,
  toolToIndexableRecord,
  computeToolsChecksum,
} from './tool-index-config'

/**
 * Result from tool search.
 */
export type ToolSearchResult = {
  /** Tool name (recordId) */
  toolName: string
  /** Relevance score */
  score: number
  /** Module that registered the tool */
  moduleId?: string
  /** Features required to use this tool */
  requiredFeatures?: string[]
}

/**
 * Status of available search strategies.
 */
export type StrategyStatus = {
  fulltext: boolean
  vector: boolean
  tokens: boolean
  /** Ordered list of available strategies */
  available: SearchStrategyId[]
  /** Strategies that will be used by default */
  default: SearchStrategyId[]
}

/**
 * Result from tool indexing operation.
 */
export type IndexingResult = {
  indexed: number
  skipped: number
  strategies: SearchStrategyId[]
  checksum: string
}

/**
 * Options for searching tools.
 */
export type ToolSearchOptions = {
  /** Maximum results to return (default: 12) */
  limit?: number
  /** Override strategies to use */
  strategies?: SearchStrategyId[]
  /** User's features for ACL filtering */
  userFeatures?: string[]
  /** Is user a super admin (bypasses ACL) */
  isSuperAdmin?: boolean
  /** Minimum score threshold (default: 0.2) */
  minScore?: number
}

/**
 * Service for searching and indexing MCP tools using hybrid search strategies.
 *
 * Uses the existing search module infrastructure to provide:
 * - Fulltext search (Meilisearch) when configured
 * - Vector/semantic search (PgVector) when configured
 * - Token-based search (PostgreSQL hash) as fallback
 *
 * Results are merged using Reciprocal Rank Fusion (RRF) with weights:
 * - fulltext: 1.2
 * - vector: 1.0
 * - tokens: 0.8
 */
export class ToolSearchService {
  private lastIndexChecksum: string | null = null

  constructor(
    private readonly searchService: SearchService,
    private readonly toolRegistry: McpToolRegistry
  ) {}

  /**
   * Get status of available search strategies.
   * This helps the AI understand which integrations are available.
   */
  async getStrategyStatus(): Promise<StrategyStatus> {
    const [fulltext, vector, tokens] = await Promise.all([
      this.searchService.isStrategyAvailable('fulltext'),
      this.searchService.isStrategyAvailable('vector'),
      this.searchService.isStrategyAvailable('tokens'),
    ])

    const available: SearchStrategyId[] = []
    if (fulltext) available.push('fulltext')
    if (vector) available.push('vector')
    if (tokens) available.push('tokens')

    const defaultStrategies = this.searchService.getDefaultStrategies()

    return {
      fulltext,
      vector,
      tokens,
      available,
      default: defaultStrategies.filter((s) => available.includes(s)),
    }
  }

  /**
   * Search for relevant tools using hybrid strategies.
   *
   * @param query - User's search query or message
   * @param options - Search options
   * @returns Array of matching tools sorted by relevance
   */
  async searchTools(
    query: string,
    options: ToolSearchOptions = {}
  ): Promise<ToolSearchResult[]> {
    const {
      limit = TOOL_SEARCH_CONFIG.defaultLimit,
      strategies,
      userFeatures = [],
      isSuperAdmin = false,
      minScore = TOOL_SEARCH_CONFIG.minScore,
    } = options

    // Use hybrid search with all available strategies
    const searchResults = await this.searchService.search(query, {
      tenantId: GLOBAL_TENANT_ID,
      organizationId: null,
      entityTypes: [TOOL_ENTITY_ID],
      strategies,
      limit: limit * 2, // Get extra results to account for ACL filtering
    })

    // Map to tool results and filter by ACL
    const toolResults: ToolSearchResult[] = []

    for (const result of searchResults) {
      // Skip results below minimum score
      if (result.score < minScore) continue

      const metadata = result.metadata as Record<string, unknown> | undefined
      const requiredFeatures = (metadata?.requiredFeatures as string[]) ?? []
      const moduleId = metadata?.moduleId as string | undefined

      // Filter by user's feature access
      if (!this.hasFeatureAccess(requiredFeatures, userFeatures, isSuperAdmin)) {
        continue
      }

      toolResults.push({
        toolName: result.recordId,
        score: result.score,
        moduleId,
        requiredFeatures,
      })

      // Stop when we have enough results
      if (toolResults.length >= limit) break
    }

    return toolResults
  }

  /**
   * Index all tools from the registry using available strategies.
   * Uses checksum-based change detection to avoid unnecessary re-indexing.
   *
   * @param force - Force re-indexing even if checksum hasn't changed
   * @returns Indexing result with statistics
   */
  async indexTools(force = false): Promise<IndexingResult> {
    const tools = Array.from(this.toolRegistry.getTools().values())
    const modules = this.getToolModules()

    // Compute checksum to detect changes
    const checksum = computeToolsChecksum(
      tools.map((t) => ({ name: t.name, description: t.description }))
    )

    // Skip if checksum matches and not forced
    if (!force && this.lastIndexChecksum === checksum) {
      const status = await this.getStrategyStatus()
      return {
        indexed: 0,
        skipped: tools.length,
        strategies: status.available,
        checksum,
      }
    }

    // Build indexable records for all tools
    const records: IndexableRecord[] = []
    for (const tool of tools) {
      const moduleId = modules.get(tool.name)
      records.push(toolToIndexableRecord(tool, moduleId))
    }

    // Bulk index using available strategies
    if (records.length > 0) {
      await this.searchService.bulkIndex(records)
    }

    // Update checksum
    this.lastIndexChecksum = checksum

    const status = await this.getStrategyStatus()
    return {
      indexed: records.length,
      skipped: 0,
      strategies: status.available,
      checksum,
    }
  }

  /**
   * Purge all tool records from the search index.
   * Useful for cleanup or complete re-indexing.
   */
  async purgeIndex(): Promise<void> {
    await this.searchService.purge(TOOL_ENTITY_ID, GLOBAL_TENANT_ID)
    this.lastIndexChecksum = null
  }

  /**
   * Get tools by module ID from the registry.
   */
  getToolsByModule(moduleId: string): string[] {
    return this.toolRegistry.listToolsByModule(moduleId)
  }

  /**
   * Build a map of tool name to module ID.
   */
  private getToolModules(): Map<string, string> {
    const modules = new Map<string, string>()

    // Common module prefixes that indicate tool ownership
    const modulePatterns = [
      { pattern: /^customers_/, moduleId: 'customers' },
      { pattern: /^sales_/, moduleId: 'sales' },
      { pattern: /^catalog_/, moduleId: 'catalog' },
      { pattern: /^staff_/, moduleId: 'staff' },
      { pattern: /^resources_/, moduleId: 'resources' },
      { pattern: /^planner/, moduleId: 'planner' },
      { pattern: /^search_/, moduleId: 'search' },
      { pattern: /^context_/, moduleId: 'context' },
      { pattern: /^auth_/, moduleId: 'auth' },
      { pattern: /^directory_/, moduleId: 'directory' },
      { pattern: /^dashboards_/, moduleId: 'dashboards' },
      { pattern: /^entities_/, moduleId: 'entities' },
      { pattern: /^dictionaries_/, moduleId: 'dictionaries' },
      { pattern: /^workflows_/, moduleId: 'workflows' },
      { pattern: /^business_rules_/, moduleId: 'business_rules' },
      { pattern: /^audit_logs_/, moduleId: 'audit_logs' },
      { pattern: /^attachments_/, moduleId: 'attachments' },
      { pattern: /^feature_toggles_/, moduleId: 'feature_toggles' },
      { pattern: /^currencies_/, moduleId: 'currencies' },
      { pattern: /^example_/, moduleId: 'example' },
      { pattern: /^cli_/, moduleId: 'cli' },
    ]

    for (const toolName of this.toolRegistry.listToolNames()) {
      for (const { pattern, moduleId } of modulePatterns) {
        if (pattern.test(toolName)) {
          modules.set(toolName, moduleId)
          break
        }
      }
    }

    return modules
  }

  /**
   * Check if user has required features to access a tool.
   */
  private hasFeatureAccess(
    requiredFeatures: string[] | undefined,
    userFeatures: string[],
    isSuperAdmin: boolean
  ): boolean {
    if (isSuperAdmin) return true
    if (!requiredFeatures?.length) return true

    return requiredFeatures.every((required) => {
      // Direct match
      if (userFeatures.includes(required)) return true
      // Wildcard match
      if (userFeatures.includes('*')) return true

      // Prefix wildcard match (e.g., 'customers.*' matches 'customers.people.view')
      return userFeatures.some((feature) => {
        if (feature.endsWith('.*')) {
          const prefix = feature.slice(0, -2)
          return required.startsWith(prefix + '.')
        }
        return false
      })
    })
  }
}
