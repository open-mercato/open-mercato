import { z } from 'zod'
import type { SearchService } from '@open-mercato/search/service'
import { registerMcpTool, getToolRegistry } from './tool-registry'
import type { McpToolDefinition, McpToolContext } from './types'
import { ToolSearchService } from './tool-search'
import { loadApiDiscoveryTools } from './api-discovery-tools'

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

  // 2. Register entity graph tools
  try {
    const { entityGraphTools } = await import('./entity-graph-tools')
    for (const tool of entityGraphTools) {
      registerMcpTool(tool, { moduleId: 'schema' })
    }
    console.error(`[MCP Tools] Registered ${entityGraphTools.length} entity graph tools`)
  } catch (error) {
    console.error('[MCP Tools] Could not load entity graph tools:', error)
  }

  // 3. Load manual ai-tools.ts files from modules
  const moduleToolPaths = [
    { moduleId: 'search', importPath: '@open-mercato/search/modules/search/ai-tools' },
    // Add more modules here as they define ai-tools.ts
  ]

  for (const { moduleId, importPath } of moduleToolPaths) {
    try {
      const module = await import(importPath)
      const tools = module.aiTools ?? module.default ?? []

      if (Array.isArray(tools) && tools.length > 0) {
        loadModuleTools(moduleId, tools)
        console.error(`[MCP Tools] Loaded ${tools.length} tools from ${moduleId}`)
      }
    } catch (error) {
      // Module might not have ai-tools.ts or import failed
      // This is not an error - modules can optionally provide tools
      console.error(`[MCP Tools] Could not load tools from ${moduleId}:`, error)
    }
  }

  // 4. Load API discovery tools (api_discover, api_execute)
  try {
    const apiToolCount = await loadApiDiscoveryTools()
    console.error(`[MCP Tools] Loaded ${apiToolCount} API discovery tools`)
  } catch (error) {
    console.error('[MCP Tools] Could not load API discovery tools:', error)
  }
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
