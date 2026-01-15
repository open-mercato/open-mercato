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
  // 0. Register built-in tools
  registerMcpTool(contextWhoamiTool, { moduleId: 'context' })
  console.error('[MCP Tools] Registered built-in context_whoami tool')

  // 1. Load manual ai-tools.ts files from modules
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

  // MVP: Skip other tool loaders to keep tool count under 128 for OpenCode compatibility
  // TODO: Re-enable these once tool filtering/selection is implemented
  const LOAD_ALL_TOOLS = process.env.MCP_LOAD_ALL_TOOLS === 'true'

  if (LOAD_ALL_TOOLS) {
    // 2. Load command-derived tools
    try {
      const { loadCommandTools } = await import('./command-tools')
      const commandToolCount = await loadCommandTools()
      if (commandToolCount > 0) {
        console.error(`[MCP Tools] Loaded ${commandToolCount} tools from commands`)
      }
    } catch (error) {
      console.error('[MCP Tools] Could not load command tools:', error)
    }

    // 3. Load CLI tools via AST parsing (superadmin only)
    try {
      const { loadCliTools } = await import('./cli-tool-loader')
      const cliToolCount = await loadCliTools()
      if (cliToolCount > 0) {
        console.error(`[MCP Tools] Loaded ${cliToolCount} CLI tools (superadmin only)`)
      }
    } catch (error) {
      console.error('[MCP Tools] Could not load CLI tools:', error)
    }

    // 4. Load OpenAPI tools (fills gaps not covered by commands - mainly GET/list endpoints)
    try {
      const { loadOpenApiTools } = await import('./openapi-tool-loader')
      const openApiToolCount = await loadOpenApiTools()
      if (openApiToolCount > 0) {
        console.error(`[MCP Tools] Loaded ${openApiToolCount} OpenAPI tools`)
      }
    } catch (error) {
      console.error('[MCP Tools] Could not load OpenAPI tools:', error)
    }
  } else {
    console.error('[MCP Tools] MVP mode: Only search tools loaded (set MCP_LOAD_ALL_TOOLS=true for all tools)')
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
