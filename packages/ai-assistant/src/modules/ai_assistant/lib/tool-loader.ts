import { z } from 'zod'
import type { SearchService } from '@open-mercato/search/service'
import { registerMcpTool, getToolRegistry } from './tool-registry'
import type { McpToolDefinition, McpToolContext } from './types'
import { ToolSearchService } from './tool-search'

/**
 * Module tool definition as exported from ai-tools.ts files.
 */
type ModuleAiTool = {
  name: string
  description: string
  inputSchema: any
  requiredFeatures?: string[]
  handler: (input: any, ctx: any) => Promise<unknown>
}

/**
 * Built-in context.whoami tool that returns the current authentication context.
 * This is useful for AI to understand its current tenant/org scope.
 */
const contextWhoamiTool: McpToolDefinition = {
  name: 'context_whoami',
  description:
    'Get the current authentication context including tenant ID, organization ID, user ID, and available features. Use this to understand your current scope before performing operations.',
  inputSchema: z.object({}),
  requiredFeatures: [], // No specific feature required - available to all authenticated users
  handler: async (_input: unknown, ctx: McpToolContext) => {
    return {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      isSuperAdmin: ctx.isSuperAdmin,
      features: ctx.userFeatures,
      featureCount: ctx.userFeatures.length,
    }
  },
}

/**
 * Load and register AI tools from a module's ai-tools.ts export.
 *
 * @param moduleId - The module identifier (e.g., 'search', 'customers')
 * @param tools - Array of tool definitions from the module
 */
export function loadModuleTools(moduleId: string, tools: ModuleAiTool[]): void {
  for (const tool of tools) {
    registerMcpTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        requiredFeatures: tool.requiredFeatures,
        handler: tool.handler,
      } as McpToolDefinition,
      { moduleId }
    )
  }
}

/**
 * Dynamically load tools from known module paths.
 * This is called during MCP server startup.
 */
export async function loadAllModuleTools(): Promise<void> {
  // 1. Register built-in tools
  registerMcpTool(contextWhoamiTool, { moduleId: 'context' })
  console.error('[MCP Tools] Registered built-in context_whoami tool')

  // 2. Register Code Mode tools (search + execute)
  // These two tools replace the previous api_discover, call_api, discover_schema,
  // and all module-specific AI tools. The AI writes JavaScript that runs in a
  // node:vm sandbox with access to the OpenAPI spec and api.request().
  try {
    const { loadCodeModeTools } = await import('./codemode-tools')
    const toolCount = await loadCodeModeTools()
    console.error(`[MCP Tools] Registered ${toolCount} Code Mode tools`)
  } catch (error) {
    console.error('[MCP Tools] Could not load Code Mode tools:', error)
  }

  // Note: Auto-discovered module AI tools (from ai-tools.generated.ts) and
  // legacy API discovery tools (find_api, call_api, discover_schema) are no
  // longer loaded. Code Mode's search + execute tools cover all use cases.
}

/**
 * Index all registered tools for hybrid search discovery.
 * This should be called after loadAllModuleTools() when the search service is available.
 *
 * @param searchService - The search service from DI container
 * @param force - Force re-indexing even if checksums match
 * @returns Indexing result with statistics
 */
export async function indexToolsForSearch(
  searchService: SearchService,
  force = false
): Promise<{
  indexed: number
  skipped: number
  strategies: string[]
  checksum: string
}> {
  const registry = getToolRegistry()
  const toolSearchService = new ToolSearchService(searchService, registry)

  try {
    const result = await toolSearchService.indexTools(force)

    console.error(`[MCP Tools] Indexed ${result.indexed} tools for search`)
    console.error(`[MCP Tools] Search strategies available: ${result.strategies.join(', ')}`)

    if (result.skipped > 0) {
      console.error(`[MCP Tools] Skipped ${result.skipped} tools (unchanged)`)
    }

    return result
  } catch (error) {
    console.error('[MCP Tools] Failed to index tools for search:', error)
    throw error
  }
}

/**
 * Create a ToolSearchService instance for tool discovery.
 * Use this to get a configured service for discovering relevant tools.
 *
 * @param searchService - The search service from DI container
 * @returns Configured ToolSearchService
 */
export function createToolSearchService(searchService: SearchService): ToolSearchService {
  const registry = getToolRegistry()
  return new ToolSearchService(searchService, registry)
}
