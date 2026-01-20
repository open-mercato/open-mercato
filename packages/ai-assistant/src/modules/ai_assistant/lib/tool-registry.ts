import type { McpToolDefinition, McpToolRegistry, ToolRegistrationOptions } from './types'

/**
 * Global tool registry singleton.
 * Modules call registerMcpTool() to add their tools.
 */
class ToolRegistryImpl implements McpToolRegistry {
  private tools = new Map<string, McpToolDefinition>()
  private moduleMap = new Map<string, string[]>()

  registerTool<TInput, TOutput>(
    tool: McpToolDefinition<TInput, TOutput>,
    options?: ToolRegistrationOptions
  ): void {
    if (!tool?.name) {
      throw new Error('MCP tool must define a name')
    }

    if (this.tools.has(tool.name)) {
      console.warn(`[McpToolRegistry] Tool "${tool.name}" already registered, overwriting`)
    }

    this.tools.set(tool.name, tool as McpToolDefinition)

    if (options?.moduleId) {
      const existing = this.moduleMap.get(options.moduleId) ?? []
      if (!existing.includes(tool.name)) {
        existing.push(tool.name)
      }
      this.moduleMap.set(options.moduleId, existing)
    }
  }

  getTools(): Map<string, McpToolDefinition> {
    return new Map(this.tools)
  }

  getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name)
  }

  listToolNames(): string[] {
    return Array.from(this.tools.keys())
  }

  listToolsByModule(moduleId: string): string[] {
    return this.moduleMap.get(moduleId) ?? []
  }

  unregisterTool(name: string): void {
    this.tools.delete(name)
    for (const [moduleId, tools] of this.moduleMap.entries()) {
      const index = tools.indexOf(name)
      if (index !== -1) {
        tools.splice(index, 1)
        this.moduleMap.set(moduleId, tools)
      }
    }
  }

  clear(): void {
    this.tools.clear()
    this.moduleMap.clear()
  }
}

export const toolRegistry = new ToolRegistryImpl()

/**
 * Register an MCP tool from any module.
 *
 * Note: Tool names must match the pattern ^[a-zA-Z0-9_-]{1,128}$
 * (no dots allowed - use underscores instead).
 *
 * @example
 * ```typescript
 * import { registerMcpTool } from '@open-mercato/ai-assistant/tools'
 * import { z } from 'zod'
 *
 * registerMcpTool({
 *   name: 'customers_search',
 *   description: 'Search for customers by name or email',
 *   inputSchema: z.object({
 *     query: z.string(),
 *     limit: z.number().optional().default(10),
 *   }),
 *   requiredFeatures: ['customers.people.view'],
 *   handler: async (input, ctx) => {
 *     const queryEngine = ctx.container.resolve('queryEngine')
 *     // ... implementation
 *   }
 * }, { moduleId: 'customers' })
 * ```
 */
export function registerMcpTool<TInput, TOutput>(
  tool: McpToolDefinition<TInput, TOutput>,
  options?: ToolRegistrationOptions
): void {
  toolRegistry.registerTool(tool, options)
}

/**
 * Get the global tool registry instance.
 */
export function getToolRegistry(): McpToolRegistry {
  return toolRegistry
}

/**
 * Unregister an MCP tool by name.
 */
export function unregisterMcpTool(name: string): void {
  toolRegistry.unregisterTool(name)
}
