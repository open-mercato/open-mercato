import { dynamicTool, type Tool } from 'ai'
import type { ZodType } from 'zod'
import type { AiAgentDefinition, AiAgentMutationPolicy } from './ai-agent-definition'
import type { AiChatRequestContext } from './attachment-bridge-types'
import type { AiToolDefinition, McpToolContext } from './types'
import { loadAgentRegistry } from './agent-registry'
import { checkAgentPolicy, type AgentPolicyDenyCode } from './agent-policy'
import { toolRegistry } from './tool-registry'
import { toSafeZodSchema } from './schema-utils'

/**
 * Error thrown by `resolveAiAgentTools` (and downstream `runAiAgentText`) when
 * the agent-level policy check denies a request. Carries the structured deny
 * code so HTTP dispatchers can map it to a stable status and JSON body.
 */
export class AgentPolicyError extends Error {
  readonly code: AgentPolicyDenyCode

  constructor(code: AgentPolicyDenyCode, message: string) {
    super(message)
    this.name = 'AgentPolicyError'
    this.code = code
  }
}

export interface ResolveAiAgentToolsInput {
  agentId: string
  authContext: AiChatRequestContext
  pageContext?: Record<string, unknown>
  attachmentIds?: string[]
  /**
   * Execution mode the caller intends to run the agent in. Defaults to
   * `'chat'` to preserve the existing chat dispatcher contract. Object-mode
   * callers (see `runAiAgentObject`) MUST pass `'object'` so the policy gate
   * can reject chat-only agents early with `execution_mode_not_supported`.
   */
  requestedExecutionMode?: 'chat' | 'object'
  /**
   * Optional tenant-scoped mutation-policy DOWNGRADE. When supplied, the
   * effective policy evaluated by `checkAgentPolicy` is the most restrictive
   * of `{ agent.mutationPolicy, mutationPolicyOverride }`. Escalation is
   * rejected at the route layer; this helper trusts callers to pass only
   * values produced by the override repository.
   */
  mutationPolicyOverride?: AiAgentMutationPolicy | null
}

export interface ResolvedAgentTools {
  agent: AiAgentDefinition
  tools: Record<string, Tool<unknown, unknown>>
}

function toPolicyAuthContext(ctx: AiChatRequestContext): {
  userFeatures: string[]
  isSuperAdmin: boolean
} {
  return {
    userFeatures: ctx.features,
    isSuperAdmin: ctx.isSuperAdmin,
  }
}

function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) return 'No result returned'
  if (typeof result === 'string') return result
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

function buildToolHandlerContext(ctx: AiChatRequestContext): McpToolContext {
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    // Tool loader seeds the container per-request via loadAllModuleTools; direct
    // helper callers that bypass the MCP server get an undefined container. Tools
    // that require DI MUST guard for this themselves — identical contract to the
    // existing `executeTool` path.
    container: undefined as unknown as McpToolContext['container'],
    userFeatures: ctx.features,
    isSuperAdmin: ctx.isSuperAdmin,
  }
}

function adaptToolToAiSdk(
  tool: AiToolDefinition,
  ctx: AiChatRequestContext,
): Tool<unknown, unknown> {
  const safeSchema = toSafeZodSchema(tool.inputSchema as ZodType)
  const handlerContext = buildToolHandlerContext(ctx)
  return dynamicTool({
    description: tool.description,
    inputSchema: safeSchema,
    execute: async (args: unknown) => {
      try {
        const result = await tool.handler(args as never, handlerContext)
        return formatToolResult(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Tool "${tool.name}" failed: ${message}`)
      }
    },
  })
}

/**
 * Resolves the agent's whitelisted tools into an AI SDK `tools` map, enforcing
 * the same policy gate as the HTTP dispatcher. Throws {@link AgentPolicyError}
 * on agent-level deny; tool-level denies are skipped with a `console.warn`
 * because the agent author whitelisted a tool the caller is not currently
 * permitted to execute (deterministic non-failure — the remaining tools still
 * reach the model).
 */
export async function resolveAiAgentTools(
  input: ResolveAiAgentToolsInput,
): Promise<ResolvedAgentTools> {
  await loadAgentRegistry()

  const policyAuth = toPolicyAuthContext(input.authContext)
  const mutationPolicyOverride = input.mutationPolicyOverride ?? null
  const agentDecision = checkAgentPolicy({
    agentId: input.agentId,
    authContext: policyAuth,
    requestedExecutionMode: input.requestedExecutionMode ?? 'chat',
    mutationPolicyOverride,
  })
  if (!agentDecision.ok) {
    throw new AgentPolicyError(agentDecision.code, agentDecision.message)
  }

  const { agent } = agentDecision
  const tools: Record<string, Tool<unknown, unknown>> = {}

  for (const toolName of agent.allowedTools) {
    const toolDecision = checkAgentPolicy({
      agentId: input.agentId,
      authContext: policyAuth,
      toolName,
      mutationPolicyOverride,
    })
    if (!toolDecision.ok) {
      console.warn(
        `[AI Agents] Skipping tool "${toolName}" for agent "${agent.id}": ${toolDecision.message}`,
      )
      continue
    }

    const record = (toolDecision.tool ?? toolRegistry.getTool(toolName)) as
      | AiToolDefinition
      | undefined
    if (!record) {
      console.warn(
        `[AI Agents] Tool "${toolName}" vanished from registry between policy checks; skipping.`,
      )
      continue
    }

    try {
      tools[toolName] = adaptToolToAiSdk(record, input.authContext)
    } catch (error) {
      console.error(
        `[AI Agents] Failed to adapt tool "${toolName}" for agent "${agent.id}":`,
        error,
      )
    }
  }

  return { agent, tools }
}
