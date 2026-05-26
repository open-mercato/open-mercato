import type { McpToolContext, ToolExecutionResult } from './types'
import { getToolRegistry } from './tool-registry'
import { hasRequiredFeatures } from './auth'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

/**
 * Strip empty strings from object values so LLM-generated `""` for optional
 * fields becomes `undefined` (passes `.optional()` Zod validators).
 */
function sanitizeEmptyStrings(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() === '') continue
    result[key] = value
  }
  return result
}

/**
 * Execute a tool with full context and ACL checks.
 */
export async function executeTool(
  toolName: string,
  input: unknown,
  context: McpToolContext
): Promise<ToolExecutionResult> {
  const registry = getToolRegistry()
  const tool = registry.getTool(toolName)

  if (!tool) {
    return {
      success: false,
      error: `Tool "${toolName}" not found`,
      errorCode: 'NOT_FOUND',
    }
  }

  // ACL check
  if (tool.requiredFeatures?.length) {
    const rbacService = context.container.resolve<RbacService>('rbacService')
    const hasAccess = hasRequiredFeatures(
      tool.requiredFeatures,
      context.userFeatures,
      context.isSuperAdmin,
      rbacService
    )

    if (!hasAccess) {
      return {
        success: false,
        error: `Insufficient permissions for tool "${toolName}". Required: ${tool.requiredFeatures.join(', ')}`,
        errorCode: 'UNAUTHORIZED',
      }
    }
  }

  // LLMs often send empty strings for optional fields (e.g., `personId: ""`).
  // Strip empty strings to `undefined` before Zod parsing so `.uuid().optional()`
  // fields pass validation when the model meant "omit this field".
  const sanitizedInput = sanitizeEmptyStrings(input)

  // Input validation
  const parseResult = tool.inputSchema.safeParse(sanitizedInput)
  if (!parseResult.success) {
    // Use any cast for Zod v4 compatibility
    const issues = (parseResult.error as any).issues ?? []
    const errorMessages = issues
      .map((issue: { path: PropertyKey[]; message: string }) =>
        `${issue.path.join('.')}: ${issue.message}`
      )
      .join('; ')
    return {
      success: false,
      error: `Invalid input: ${errorMessages || 'Validation failed'}`,
      errorCode: 'VALIDATION_ERROR',
    }
  }

  // Execute tool. Attach `tool` to the context so handlers that build an
  // `AiToolExecutionContext` (e.g. via `createAiApiOperationRunner`) keep their
  // route-gate coverage check working.
  const handlerContext: McpToolContext = { ...context, tool }
  try {
    const result = await tool.handler(parseResult.data, handlerContext)
    return { success: true, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[MCP Tool] Error executing "${toolName}":`, error)
    return {
      success: false,
      error: message,
      errorCode: 'EXECUTION_ERROR',
    }
  }
}
