import { z } from 'zod'
import { registerMcpTool } from './tool-registry'
import type { McpToolDefinition, McpToolContext } from './types'

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
}
