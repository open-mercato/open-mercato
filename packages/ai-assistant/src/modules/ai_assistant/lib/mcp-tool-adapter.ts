import { z, type ZodType } from 'zod'
import { dynamicTool, type Tool } from 'ai'
import type { InProcessMcpClient, ToolInfoWithSchema } from './in-process-client'

// Log when this module is loaded to confirm code updates are being picked up
console.log('[MCP Adapter] Module loaded - v3 with Zod4 toJSONSchema fix')

// Cache for converted schemas to avoid redundant conversions
const safeSchemaCache = new WeakMap<ZodType, ZodType>()

/**
 * Convert a JSON Schema to a simple Zod schema.
 * This creates a schema that the AI SDK can convert back to JSON Schema without errors.
 */
function jsonSchemaToZod(jsonSchema: Record<string, unknown>): ZodType {
  const type = jsonSchema.type as string | undefined

  if (type === 'string') {
    return z.string()
  }
  if (type === 'number' || type === 'integer') {
    return z.number()
  }
  if (type === 'boolean') {
    return z.boolean()
  }
  if (type === 'null') {
    return z.null()
  }
  if (type === 'array') {
    const items = jsonSchema.items as Record<string, unknown> | undefined
    if (items) {
      return z.array(jsonSchemaToZod(items))
    }
    return z.array(z.unknown())
  }
  if (type === 'object') {
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined
    const required = (jsonSchema.required as string[]) || []

    if (properties) {
      const shape: Record<string, ZodType> = {}
      for (const [key, propSchema] of Object.entries(properties)) {
        let fieldSchema = jsonSchemaToZod(propSchema)
        // Make field optional if not in required array
        if (!required.includes(key)) {
          fieldSchema = fieldSchema.optional()
        }
        shape[key] = fieldSchema
      }
      return z.object(shape)
    }
    return z.object({})
  }

  // Handle anyOf (union types)
  if (jsonSchema.anyOf) {
    const anyOf = jsonSchema.anyOf as Record<string, unknown>[]
    if (anyOf.length === 2) {
      const types = anyOf.map((s) => s.type)
      // Handle nullable types (e.g., string | null)
      if (types.includes('null')) {
        const nonNullSchema = anyOf.find((s) => s.type !== 'null')
        if (nonNullSchema) {
          return jsonSchemaToZod(nonNullSchema).nullable()
        }
      }
      return z.union([jsonSchemaToZod(anyOf[0]), jsonSchemaToZod(anyOf[1])])
    }
    if (anyOf.length > 2) {
      const schemas = anyOf.map(jsonSchemaToZod) as [ZodType, ZodType, ...ZodType[]]
      return z.union(schemas)
    }
  }

  // Default to unknown for unsupported types
  return z.unknown()
}

/**
 * Convert a Zod schema to a "safe" schema that doesn't contain Date types.
 * Uses z.toJSONSchema with unrepresentable: 'any' to handle dates,
 * then converts back to Zod schema.
 */
function toSafeZodSchema(schema: ZodType): ZodType {
  // Check cache first
  const cached = safeSchemaCache.get(schema)
  if (cached) {
    return cached
  }

  try {
    // Use Zod 4's toJSONSchema with unrepresentable: 'any' to handle Date types
    const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>

    // Convert back to a simple Zod schema without Date types
    const safeSchema = jsonSchemaToZod(jsonSchema)

    // Cache the result
    safeSchemaCache.set(schema, safeSchema)

    return safeSchema
  } catch (error) {
    console.error('[MCP Adapter] Error converting schema:', error)
    // Fallback to the original schema if conversion fails
    return schema
  }
}

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
  const skippedTools: string[] = []

  console.log(`[MCP Adapter] Starting conversion of ${mcpTools.length} tools using Zod4 toJSONSchema...`)

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
      skippedTools.push(mcpTool.name)
    }
  }

  console.log(`[MCP Adapter] Conversion complete: ${Object.keys(aiTools).length} tools converted, ${skippedTools.length} skipped`)
  if (skippedTools.length > 0) {
    console.log(`[MCP Adapter] Skipped tools:`, skippedTools)
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
