import { dynamicTool, type Tool } from 'ai'
import type { AwilixContainer } from 'awilix'
import type { ZodType } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { AiAgentDefinition, AiAgentMutationPolicy } from './ai-agent-definition'
import type { AiChatRequestContext, AiUiPart } from './attachment-bridge-types'
import type { AiToolDefinition, McpToolContext } from './types'
import { loadAgentRegistry } from './agent-registry'
import {
  checkAgentPolicy,
  resolveEffectiveMutationPolicy,
  type AgentPolicyDenyCode,
} from './agent-policy'
import { toolRegistry } from './tool-registry'
import { toSafeZodSchema } from './schema-utils'
import { prepareMutation } from './prepare-mutation'

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
  /**
   * DI container used by the `prepareMutation` tool-call wrapper (Step 5.6).
   * When present AND the agent's effective mutation policy is non-read-only,
   * `isMutation: true` tools are intercepted: the runtime creates an
   * `AiPendingAction` row and enqueues a `mutation-preview-card` UI part in
   * the returned {@link ResolvedAgentTools.uiPartQueue} instead of running the
   * tool's handler. When absent, mutation tools degrade-gracefully to the
   * pre-5.6 pass-through adapter — existing read-only agents are unaffected.
   */
  container?: AwilixContainer
  /**
   * Optional chat-turn correlation id used when hashing the
   * `AiPendingAction.idempotencyKey` so retries of the same mutation collapse
   * to a single row. The chat dispatcher supplies the OpenCode / AI SDK turn
   * id here; when omitted the hash falls back to `null` which still preserves
   * per-tenant/org uniqueness within the TTL window.
   */
  conversationId?: string | null
}

/**
 * Queue of UI parts the mutation-preview wrapper accumulates during a turn.
 * The chat/object dispatcher flushes these on the next emission boundary
 * (spec §9 allows either direct streaming or this queue pattern — we ship the
 * queue in Step 5.6 and the chat dispatcher will drain it in Step 5.10 when
 * the `mutation-preview-card` component registers). BC: callers that ignore
 * the field are unaffected.
 */
export interface AiUiPartQueue {
  /** Pushed by the mutation wrapper; drained by the dispatcher in order. */
  enqueue: (part: AiUiPart) => void
  drain: () => AiUiPart[]
  size: () => number
}

function createAiUiPartQueue(): AiUiPartQueue {
  const buffer: AiUiPart[] = []
  return {
    enqueue: (part) => {
      buffer.push(part)
    },
    drain: () => {
      const snapshot = buffer.slice()
      buffer.length = 0
      return snapshot
    },
    size: () => buffer.length,
  }
}

export interface ResolvedAgentTools {
  agent: AiAgentDefinition
  tools: Record<string, Tool<unknown, unknown>>
  /**
   * Per-request UI-part queue the chat dispatcher drains between streamText
   * chunks (Step 5.10 contract). Always present; empty when no mutation-tool
   * calls fire during the turn.
   */
  uiPartQueue: AiUiPartQueue
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

/**
 * Sanitize a dotted tool name (e.g. `search.hybrid_search`) into a format
 * accepted by all major LLM providers. OpenAI requires tool names to match
 * `^[a-zA-Z0-9_-]+$`; dots are replaced with double underscores (`__`).
 * Anthropic and Google accept both formats, so this is safe across providers.
 */
function sanitizeToolNameForModel(name: string): string {
  return name.replace(/\./g, '__')
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

function buildToolHandlerContext(
  ctx: AiChatRequestContext,
  container?: AwilixContainer,
  tool?: AiToolDefinition,
): McpToolContext {
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    container: (container ?? undefined) as unknown as McpToolContext['container'],
    userFeatures: ctx.features,
    isSuperAdmin: ctx.isSuperAdmin,
    ...(tool ? { tool } : {}),
  }
}

interface MutationInterceptorOptions {
  agent: AiAgentDefinition
  tool: AiToolDefinition
  container: AwilixContainer
  ctx: AiChatRequestContext
  mutationPolicyOverride: AiAgentMutationPolicy | null
  conversationId: string | null
  uiPartQueue: AiUiPartQueue
}

function formatPendingActionToolResult(
  agent: AiAgentDefinition,
  tool: AiToolDefinition,
  pendingActionId: string,
  expiresAt: Date,
): string {
  return formatToolResult({
    status: 'pending-confirmation',
    agentId: agent.id,
    toolName: tool.name,
    pendingActionId,
    expiresAt: expiresAt.toISOString(),
    message: `Awaiting user confirmation for mutation "${tool.name}". The action will NOT run until the user approves it.`,
  })
}

function adaptToolToAiSdk(
  tool: AiToolDefinition,
  ctx: AiChatRequestContext,
  mutation: MutationInterceptorOptions | null,
  container?: AwilixContainer,
): Tool<unknown, unknown> {
  const safeSchema = toSafeZodSchema(tool.inputSchema as ZodType)
  const handlerContext = buildToolHandlerContext(ctx, container, tool)
  return dynamicTool({
    description: tool.description,
    inputSchema: safeSchema,
    execute: async (args: unknown) => {
      if (mutation) {
        try {
          const toolCallArgs =
            args && typeof args === 'object' && !Array.isArray(args)
              ? { ...(args as Record<string, unknown>) }
              : {}
          const { uiPart, pendingAction } = await prepareMutation(
            {
              agent: mutation.agent,
              tool: mutation.tool,
              toolCallArgs,
              conversationId: mutation.conversationId,
              mutationPolicyOverride: mutation.mutationPolicyOverride,
            },
            {
              tenantId: mutation.ctx.tenantId,
              organizationId: mutation.ctx.organizationId,
              userId: mutation.ctx.userId,
              features: mutation.ctx.features,
              isSuperAdmin: mutation.ctx.isSuperAdmin,
              container: mutation.container,
            },
          )
          mutation.uiPartQueue.enqueue(uiPart)
          return formatPendingActionToolResult(
            mutation.agent,
            mutation.tool,
            pendingAction.id,
            pendingAction.expiresAt,
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Tool "${tool.name}" could not be prepared for confirmation: ${message}`,
          )
        }
      }
      try {
        // Create a fresh container per tool call so the EM is never stale.
        const freshContainer = await createRequestContainer()
        const freshContext: McpToolContext = {
          ...handlerContext,
          container: freshContainer as unknown as McpToolContext['container'],
        }
        const { executeTool } = await import('./tool-executor')
        const execResult = await executeTool(tool.name, args, freshContext)
        if (!execResult.success) {
          throw new Error(execResult.error || 'Tool execution failed')
        }
        return formatToolResult(execResult.result)
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
  const uiPartQueue = createAiUiPartQueue()
  const effectiveMutationPolicy = resolveEffectiveMutationPolicy(
    agent.mutationPolicy,
    mutationPolicyOverride,
    agent.id,
  )
  const canInterceptMutations =
    effectiveMutationPolicy !== 'read-only' && typeof input.container !== 'undefined'

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
      const mutationOptions: MutationInterceptorOptions | null =
        record.isMutation === true && canInterceptMutations && input.container
          ? {
              agent,
              tool: record,
              container: input.container,
              ctx: input.authContext,
              mutationPolicyOverride,
              conversationId: input.conversationId ?? null,
              uiPartQueue,
            }
          : null
      // Sanitize tool name for model API compatibility: OpenAI requires
      // names matching ^[a-zA-Z0-9_-]+$ (no dots). Replace dots with
      // double underscores so `search.hybrid_search` becomes
      // `search__hybrid_search`. The AI SDK uses the record key as the
      // tool name sent to the model; the original dotted name stays on
      // the `tool` object for logging and prepareMutation hashing.
      const modelSafeToolName = sanitizeToolNameForModel(toolName)
      tools[modelSafeToolName] = adaptToolToAiSdk(record, input.authContext, mutationOptions, input.container)
    } catch (error) {
      console.error(
        `[AI Agents] Failed to adapt tool "${toolName}" for agent "${agent.id}":`,
        error,
      )
    }
  }

  return { agent, tools, uiPartQueue }
}
