import type { McpToolContext, ToolExecutionResult } from './types'
import { getToolRegistry } from './tool-registry'
import { hasRequiredFeatures } from './auth'

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
    const hasAccess = hasRequiredFeatures(
      tool.requiredFeatures,
      context.userFeatures,
      context.isSuperAdmin
    )

    if (!hasAccess) {
      return {
        success: false,
        error: `Insufficient permissions for tool "${toolName}". Required: ${tool.requiredFeatures.join(', ')}`,
        errorCode: 'UNAUTHORIZED',
      }
    }
  }

  // Input validation
  const parseResult = tool.inputSchema.safeParse(input)
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

  // Execute tool
  try {
    const result = await tool.handler(parseResult.data, context)
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
