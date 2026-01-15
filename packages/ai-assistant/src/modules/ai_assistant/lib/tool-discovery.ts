import type { SearchStrategyId } from '@open-mercato/search/types'
import type { ToolSearchService, StrategyStatus, ToolSearchResult } from './tool-search'
import type { McpToolRegistry, McpToolContext } from './types'
import { ESSENTIAL_TOOLS } from './tool-index-config'

/**
 * Quality level of discovery results.
 */
export type DiscoveryQuality =
  | 'excellent' // High confidence matches
  | 'good' // Reasonable matches
  | 'fallback_module' // Used module-based fallback
  | 'fallback_essential' // Using essential tools only

/**
 * Result from tool discovery.
 */
export type DiscoveryResult = {
  /** Tool names to include in LLM context */
  tools: string[]
  /** Search strategies that were used */
  strategies: SearchStrategyId[]
  /** Quality level of the discovery */
  quality: DiscoveryQuality
  /** Module detected from query (if any) */
  detectedModule?: string
  /** Search scores for transparency */
  scores?: Map<string, number>
  /** Timing in milliseconds */
  timing?: number
}

/**
 * Options for tool discovery.
 */
export type DiscoveryOptions = {
  /** Maximum tools to return (default: 15) */
  limit?: number
  /** Minimum score threshold for "good" results (default: 0.3) */
  minGoodScore?: number
  /** Minimum number of results for "good" quality (default: 3) */
  minGoodCount?: number
  /** Include essential tools regardless of search (default: true) */
  includeEssential?: boolean
  /** Override strategies to use */
  strategies?: SearchStrategyId[]
}

/**
 * Module patterns for fallback detection.
 * Maps query keywords to module IDs.
 */
const MODULE_KEYWORDS: Array<{ keywords: string[]; moduleId: string }> = [
  { keywords: ['customer', 'person', 'people', 'company', 'contact', 'deal'], moduleId: 'customers' },
  { keywords: ['order', 'quote', 'invoice', 'payment', 'shipment', 'shipping'], moduleId: 'sales' },
  { keywords: ['product', 'variant', 'price', 'catalog', 'category', 'offer'], moduleId: 'catalog' },
  { keywords: ['book', 'reservation', 'appointment', 'schedule', 'resource', 'team'], moduleId: 'booking' },
  { keywords: ['search', 'find', 'query', 'lookup'], moduleId: 'search' },
  { keywords: ['user', 'role', 'permission', 'auth', 'login'], moduleId: 'auth' },
  { keywords: ['tenant', 'organization', 'directory'], moduleId: 'directory' },
  { keywords: ['workflow', 'automation', 'rule', 'business rule'], moduleId: 'workflows' },
  { keywords: ['dashboard', 'widget', 'metric'], moduleId: 'dashboards' },
  { keywords: ['entity', 'field', 'custom field', 'definition'], moduleId: 'entities' },
  { keywords: ['dictionary', 'lookup', 'dropdown'], moduleId: 'dictionaries' },
  { keywords: ['currency', 'exchange', 'rate'], moduleId: 'currencies' },
  { keywords: ['attachment', 'file', 'upload', 'media'], moduleId: 'attachments' },
  { keywords: ['audit', 'log', 'history', 'action'], moduleId: 'audit_logs' },
  { keywords: ['feature', 'toggle', 'flag'], moduleId: 'feature_toggles' },
]

/**
 * Detect module from query using keyword matching.
 *
 * @param query - User's search query
 * @returns Detected module ID or undefined
 */
export function detectModuleFromQuery(query: string): string | undefined {
  const lowerQuery = query.toLowerCase()

  for (const { keywords, moduleId } of MODULE_KEYWORDS) {
    if (keywords.some((kw) => lowerQuery.includes(kw))) {
      return moduleId
    }
  }

  return undefined
}

/**
 * Discover relevant tools for a user query using hybrid search strategies.
 *
 * This function:
 * 1. Checks available search strategies (fulltext, vector, tokens)
 * 2. Performs hybrid search using best available strategies
 * 3. Evaluates result quality
 * 4. Falls back to module-based or essential tools if needed
 *
 * @param query - User's search query or message
 * @param context - Tool execution context with user permissions
 * @param toolSearchService - Service for hybrid tool search
 * @param toolRegistry - Registry to access tools by module
 * @param options - Discovery options
 * @returns Discovery result with tools and metadata
 */
export async function discoverTools(
  query: string,
  context: McpToolContext,
  toolSearchService: ToolSearchService,
  toolRegistry: McpToolRegistry,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const {
    limit = 15,
    minGoodScore = 0.3,
    minGoodCount = 3,
    includeEssential = true,
    strategies,
  } = options

  const startTime = Date.now()

  // Get available strategies for transparency
  const strategyStatus = await toolSearchService.getStrategyStatus()

  // Perform hybrid search
  const searchResults = await toolSearchService.searchTools(query, {
    limit,
    strategies,
    userFeatures: context.userFeatures,
    isSuperAdmin: context.isSuperAdmin,
  })

  // Build scores map for transparency
  const scores = new Map<string, number>()
  for (const result of searchResults) {
    scores.set(result.toolName, result.score)
  }

  // Evaluate result quality
  const topScore = searchResults[0]?.score ?? 0
  const goodResultsCount = searchResults.filter((r) => r.score >= minGoodScore).length

  // Determine quality level
  let quality: DiscoveryQuality
  let tools: string[]
  let detectedModule: string | undefined

  if (topScore >= 0.5 && goodResultsCount >= minGoodCount) {
    // Excellent results - high confidence matches
    quality = 'excellent'
    tools = searchResults.map((r) => r.toolName)
  } else if (topScore >= minGoodScore && goodResultsCount >= 2) {
    // Good results - reasonable matches
    quality = 'good'
    tools = searchResults.map((r) => r.toolName)
  } else {
    // Need fallback
    detectedModule = detectModuleFromQuery(query)

    if (detectedModule) {
      // Module-based fallback
      quality = 'fallback_module'
      const moduleTools = toolRegistry.listToolsByModule(detectedModule)

      // Combine search results with module tools, deduplicated
      tools = [...new Set([...searchResults.map((r) => r.toolName), ...moduleTools])]
    } else {
      // Essential tools fallback
      quality = 'fallback_essential'
      tools = [...searchResults.map((r) => r.toolName)]
    }
  }

  // Always include essential tools if requested
  if (includeEssential) {
    const essentialSet = new Set(ESSENTIAL_TOOLS)
    const existingTools = new Set(tools)

    for (const essential of essentialSet) {
      if (!existingTools.has(essential)) {
        tools.push(essential)
      }
    }
  }

  // Enforce limit
  if (tools.length > limit) {
    tools = tools.slice(0, limit)
  }

  return {
    tools,
    strategies: strategyStatus.available,
    quality,
    detectedModule,
    scores,
    timing: Date.now() - startTime,
  }
}

/**
 * Get tools for multi-turn conversations.
 * Expands the tool set to include:
 * - Tools from previous turns
 * - Tools related to entities mentioned in conversation
 *
 * @param query - Current user message
 * @param context - Tool execution context
 * @param toolSearchService - Search service
 * @param toolRegistry - Tool registry
 * @param previousTools - Tools used in previous conversation turns
 * @param mentionedEntities - Entity types mentioned in conversation
 * @returns Expanded discovery result
 */
export async function discoverToolsWithContext(
  query: string,
  context: McpToolContext,
  toolSearchService: ToolSearchService,
  toolRegistry: McpToolRegistry,
  previousTools: string[] = [],
  mentionedEntities: string[] = []
): Promise<DiscoveryResult> {
  // Get base discovery
  const baseResult = await discoverTools(query, context, toolSearchService, toolRegistry)

  // Expand with previous tools (limited to avoid bloat)
  const previousLimit = 5
  const recentTools = previousTools.slice(-previousLimit)

  // Expand with entity-related tools
  const entityTools: string[] = []
  for (const entity of mentionedEntities) {
    // Entity format is usually "module:entity", extract module
    const moduleId = entity.split(':')[0]
    if (moduleId) {
      const moduleTools = toolRegistry.listToolsByModule(moduleId).slice(0, 3)
      entityTools.push(...moduleTools)
    }
  }

  // Combine all tools, deduplicated
  const allTools = new Set([
    ...baseResult.tools,
    ...recentTools,
    ...entityTools,
  ])

  return {
    ...baseResult,
    tools: Array.from(allTools).slice(0, 20), // Cap at 20 for multi-turn
  }
}

/**
 * Quick check if tool discovery is available.
 * Returns false if search service is not configured.
 */
export async function isDiscoveryAvailable(
  toolSearchService: ToolSearchService
): Promise<boolean> {
  try {
    const status = await toolSearchService.getStrategyStatus()
    // At minimum, tokens strategy should always be available
    return status.tokens === true
  } catch {
    return false
  }
}

/**
 * Get discovery status for debugging/monitoring.
 */
export async function getDiscoveryStatus(
  toolSearchService: ToolSearchService,
  toolRegistry: McpToolRegistry
): Promise<{
  available: boolean
  strategies: StrategyStatus
  indexedTools: number
  essentialTools: string[]
}> {
  const strategies = await toolSearchService.getStrategyStatus()
  const toolCount = toolRegistry.listToolNames().length

  return {
    available: strategies.tokens,
    strategies,
    indexedTools: toolCount,
    essentialTools: [...ESSENTIAL_TOOLS],
  }
}
