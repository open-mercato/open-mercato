import { dynamicTool, type Tool } from 'ai'
import type { InProcessMcpClient, ToolInfoWithSchema } from './in-process-client'
import { toSafeZodSchema } from './schema-utils'

/**
 * Convert MCP tools to Vercel AI SDK format.
 *
 * This adapter takes tools from an MCP client and converts them
 * to the format expected by the AI SDK's streamText function.
 *
 * Uses dynamicTool for dynamic schema support, which allows
 * tools with runtime-determined schemas (from MCP servers).
 *
 * @param mcpClient - MCP client to execute tools
 * @param mcpTools - List of tools with Zod schemas
 * @returns Record of AI SDK tools
 */
export function convertMcpToolsToAiSdk(
  mcpClient: InProcessMcpClient,
  mcpTools: ToolInfoWithSchema[]
): Record<string, Tool<unknown, unknown>> {
  const aiTools: Record<string, Tool<unknown, unknown>> = {}

  for (const mcpTool of mcpTools) {
    try {
      // Convert schema using Zod4's toJSONSchema with unrepresentable: 'any'
      // This handles Date types by converting them to 'any' in JSON Schema,
      // then we convert back to a clean Zod schema
      const safeSchema = toSafeZodSchema(mcpTool.inputSchema)

      aiTools[mcpTool.name] = dynamicTool({
        description: mcpTool.description,
        inputSchema: safeSchema,
        execute: async (args: unknown) => {
          const result = await mcpClient.callTool(mcpTool.name, args)

          if (!result.success) {
            throw new Error(result.error || 'Tool execution failed')
          }

          // Return the result in a format suitable for LLM consumption
          return formatToolResult(result.result)
        },
      })
    } catch (error) {
      console.error(`[MCP Adapter] Error converting tool "${mcpTool.name}":`, error)
    }
  }

  return aiTools
}

/**
 * Format tool result for LLM consumption.
 * Converts various result types to a string representation.
 */
function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) {
    return 'No result returned'
  }

  if (typeof result === 'string') {
    return result
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result)
  }

  // For objects and arrays, return JSON representation
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
