import { createLogger } from '@open-mercato/shared/lib/logger'
import type { McpToolContext, ToolExecutionResult } from './types'
import { getToolRegistry } from './tool-registry'
import { hasRequiredFeatures } from './auth'
import { parseToolInput } from './tool-input'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

const logger = createLogger('ai_assistant')

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

  const parseResult = parseToolInput(tool.inputSchema, input)
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error,
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
    logger.error('Error executing tool', { toolName, err: error })
    return {
      success: false,
      error: message,
      errorCode: 'EXECUTION_ERROR',
    }
  }
}
