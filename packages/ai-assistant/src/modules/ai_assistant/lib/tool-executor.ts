import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { AiToolDefinition, McpToolContext, McpToolDefinition, ToolExecutionResult } from './types'
import { getToolRegistry } from './tool-registry'
import { hasRequiredFeatures } from './auth'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { isMutationTool } from './mcp-audit'
import { isRefusedInApprovalMode, type McpMutationMode } from './mcp-exposure'
import { AiMutationPreparationError, prepareRawToolMutation } from './prepare-mutation'
import { isAgentToolError } from './agent-tool-error'

const logger = createLogger('ai_assistant')

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

export type ToolExecutionChannel = 'agent' | 'mcp' | 'tools-api'

export type ToolExecutionRequester = {
  userId: string | null
  apiKeyId: string | null
}

export type ExecuteToolOptions = {
  channel?: ToolExecutionChannel
  mutationMode?: McpMutationMode
  requester?: ToolExecutionRequester
  correlationId?: string | null
}

export const PENDING_ACTION_APPROVAL_PATH_PREFIX = '/backend/config/ai-assistant/pending-actions/'

function buildMutationRequiresApprovalResult(toolName: string): ToolExecutionResult {
  return {
    success: false,
    error: `Tool "${toolName}" is a mutation and cannot run directly on this channel (mutation mode requires approval or denies mutations)`,
    errorCode: 'MUTATION_REQUIRES_APPROVAL',
  }
}

function buildRefusedInApprovalModeResult(toolName: string): ToolExecutionResult {
  return {
    success: false,
    error: `Tool "${toolName}" is not available in approval mode: an approved execution cannot reproduce it, so it is refused on this channel while OM_MCP_MUTATION_MODE=approval`,
    errorCode: 'MUTATION_REQUIRES_APPROVAL',
  }
}

function toArgsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

async function queueMutationForApproval(
  tool: AiToolDefinition,
  parsedInput: unknown,
  context: McpToolContext,
  channel: 'mcp' | 'tools-api',
  options: ExecuteToolOptions,
): Promise<ToolExecutionResult> {
  try {
    const { pendingAction, summary } = await prepareRawToolMutation(
      {
        tool,
        toolCallArgs: toArgsRecord(parsedInput),
        channel,
        requesterUserId: options.requester?.userId ?? null,
        apiKeyId: options.requester?.apiKeyId ?? null,
        correlationId: options.correlationId ?? null,
      },
      { ...context, tool },
    )
    const pendingActionId = pendingAction.id
    const expiresAt = pendingAction.expiresAt.toISOString()
    return {
      success: true,
      pendingApproval: { pendingActionId, expiresAt },
      result: {
        status: 'pending_approval',
        pendingActionId,
        expiresAt,
        approvalPath: `${PENDING_ACTION_APPROVAL_PATH_PREFIX}${pendingActionId}`,
        summary,
      },
    }
  } catch (error) {
    if (error instanceof AiMutationPreparationError && error.code === 'requester_unresolved') {
      return {
        success: false,
        error: `Tool "${tool.name}" is a mutation that requires approval, but no requesting user could be resolved for this call`,
        errorCode: 'MUTATION_REQUESTER_UNRESOLVED',
      }
    }
    logger.error('Error queueing mutation for approval', { toolName: tool.name, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'ai_assistant',
      code: 'ai_assistant.raw_tool_pending_action_failed',
      attributes: { toolName: tool.name, channel },
    })
    return {
      success: false,
      error: `Tool "${tool.name}" could not be queued for approval`,
      errorCode: 'EXECUTION_ERROR',
    }
  }
}

async function resolveMutationGate(
  tool: AiToolDefinition,
  parsedInput: unknown,
  context: McpToolContext,
  options: ExecuteToolOptions,
): Promise<ToolExecutionResult | null> {
  const channel = options.channel ?? 'agent'
  if (channel === 'agent') return null
  const mutationMode = options.mutationMode ?? 'direct'
  if (mutationMode === 'direct') return null
  if (mutationMode === 'approval') {
    if (isRefusedInApprovalMode(tool, mutationMode)) return buildRefusedInApprovalModeResult(tool.name)
    return queueMutationForApproval(tool, parsedInput, context, channel, options)
  }
  return buildMutationRequiresApprovalResult(tool.name)
}

function buildHandlerContext(
  context: McpToolContext,
  tool: McpToolDefinition,
  options: ExecuteToolOptions,
): McpToolContext {
  const handlerContext: McpToolContext = { ...context, tool }
  if (options.channel) handlerContext.channel = options.channel
  if (options.mutationMode) handlerContext.mutationMode = options.mutationMode
  if (options.correlationId) handlerContext.correlationId = options.correlationId
  if (options.requester && options.requester.apiKeyId) handlerContext.apiKeyId = options.requester.apiKeyId
  if (options.requester && options.requester.userId) handlerContext.requesterUserId = options.requester.userId
  return handlerContext
}

/**
 * Execute a tool with full context and ACL checks.
 */
export async function executeTool(
  toolName: string,
  input: unknown,
  context: McpToolContext,
  options: ExecuteToolOptions = {}
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

  if (isMutationTool(tool)) {
    const gateResult = await resolveMutationGate(tool as AiToolDefinition, parseResult.data, context, options)
    if (gateResult) return gateResult
  }

  // Execute tool. Attach `tool` to the context so handlers that build an
  // `AiToolExecutionContext` (e.g. via `createAiApiOperationRunner`) keep their
  // route-gate coverage check working.
  const handlerContext = buildHandlerContext(context, tool, options)
  try {
    const result = await tool.handler(parseResult.data, handlerContext)
    return { success: true, result }
  } catch (error) {
    if (isAgentToolError(error)) {
      logger.warn('Agent tool call refused', { toolName, code: error.code, denyCode: error.denyCode })
      return {
        success: false,
        error: error.code === 'AGENT_POLICY_DENIED'
          ? `Tool "${toolName}" was denied by the agent policy (${error.denyCode ?? 'agent_policy_denied'})`
          : `Tool "${toolName}" cannot run: its agent is not available`,
        errorCode: error.code,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Error executing tool', { toolName, err: error })
    return {
      success: false,
      error: message,
      errorCode: 'EXECUTION_ERROR',
    }
  }
}

export type PendingApprovalMcpResponse = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
  isError: false
}

export function buildPendingApprovalMcpResponse(result: ToolExecutionResult): PendingApprovalMcpResponse {
  const structuredContent = toArgsRecord(result.result)
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: false,
  }
}
