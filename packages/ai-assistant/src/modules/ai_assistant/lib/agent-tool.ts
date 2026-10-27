import { randomUUID } from 'node:crypto'
import { z, type ZodTypeAny } from 'zod'
import { checkAgentPolicy } from './agent-policy'
import { getAgent, loadAgentRegistry } from './agent-registry'
import { runAiAgentObject } from './agent-runtime'
import { AgentPolicyError } from './agent-tools'
import type { AiAgentRunChannel } from './agent-call-contract'
import {
  isAiAgentDispatchDeniedError,
  resolveAiAgentRunDispatcher,
  type AiAgentRunDispatchCaller,
  type AiAgentRunDispatcher,
} from './agent-run-dispatcher'
import { AgentToolError } from './agent-tool-error'
import { hasRequiredFeatures } from './auth'
import type { AiToolDefinition, McpToolContext } from './types'

export const AGENT_TOOL_DEFAULT_TIMEOUT_MS = 120_000

export type AgentToolResult<TOutput> = {
  result: TOutput
  agentId: string
  runId: string | null
  agentRunId: string | null
}

export type DefineAgentToolSpec<TInput, TOutput> = {
  name: string
  description: string
  agentId: string
  inputSchema: z.ZodType<TInput>
  outputSchema?: z.ZodType<TOutput>
  toPrompt?: (input: TInput) => string
  requiredFeatures?: string[]
  timeoutMs?: number
}

export function isAgentToolFeatureSuperset(
  toolFeatures: readonly string[],
  agentFeatures: readonly string[] | undefined,
): boolean {
  if (!agentFeatures || agentFeatures.length === 0) return true
  return hasRequiredFeatures([...agentFeatures], [...toolFeatures], false)
}

export function buildAgentToolOutputSchema(resultSchema?: ZodTypeAny): ZodTypeAny {
  return z.object({
    result: resultSchema ?? z.unknown(),
    agentId: z.string(),
    runId: z.string().nullable(),
    agentRunId: z.string().nullable(),
  })
}

export function toAgentRunChannel(channel: McpToolContext['channel']): AiAgentRunChannel {
  if (channel === 'mcp') return 'mcp'
  if (channel === 'tools-api') return 'tools-api'
  return 'chat'
}

function defaultToPrompt(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const candidate = (input as Record<string, unknown>).input
    if (typeof candidate === 'string') return candidate
  }
  return JSON.stringify(input)
}

function resolveCorrelationId(context: McpToolContext): string {
  return context.correlationId ?? context.auditCorrelation?.correlationId ?? randomUUID()
}

function resolveApiKeyId(context: McpToolContext): string | null {
  return context.apiKeyId ?? context.auditCorrelation?.apiKeyId ?? null
}

function buildDispatchCaller(agentId: string, context: McpToolContext): AiAgentRunDispatchCaller {
  if (!context.tenantId || !context.organizationId) {
    throw new AgentToolError('AGENT_POLICY_DENIED', agentId, 'agent_principal_missing')
  }
  return {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    userId: context.userId,
    apiKeyId: resolveApiKeyId(context),
    features: context.userFeatures,
    isSuperAdmin: context.isSuperAdmin,
  }
}

async function withTimeout<TValue>(
  toolName: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<TValue>,
): Promise<TValue> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`[internal] Agent tool "${toolName}" timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function validateAgainst(schema: ZodTypeAny | undefined, value: unknown, toolName: string): unknown {
  if (!schema || typeof schema.safeParse !== 'function') return value
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`[internal] Agent tool "${toolName}" received an object that does not match its output schema`)
  }
  return parsed.data
}

async function runThroughDispatcher<TInput>(
  dispatcher: AiAgentRunDispatcher,
  spec: DefineAgentToolSpec<TInput, unknown>,
  input: TInput,
  context: McpToolContext,
  correlationId: string,
  timeoutMs: number,
): Promise<AgentToolResult<unknown>> {
  if (!(await dispatcher.isAvailable(spec.agentId))) {
    throw new AgentToolError('AGENT_DISPATCHER_UNAVAILABLE', spec.agentId)
  }
  const caller = buildDispatchCaller(spec.agentId, context)
  try {
    const dispatched = await withTimeout(spec.name, timeoutMs, (signal) =>
      dispatcher.runObject({
        agentId: spec.agentId,
        input,
        caller,
        channel: toAgentRunChannel(context.channel),
        via: 'tool',
        correlationId,
        timeoutMs,
        signal,
      }),
    )
    return {
      result: validateAgainst(spec.outputSchema, dispatched.result, spec.name),
      agentId: spec.agentId,
      runId: null,
      agentRunId: dispatched.agentRunId,
    }
  } catch (error) {
    if (isAiAgentDispatchDeniedError(error)) {
      throw new AgentToolError('AGENT_POLICY_DENIED', spec.agentId, error.code)
    }
    throw error
  }
}

async function runThroughAiAssistant<TInput>(
  spec: DefineAgentToolSpec<TInput, unknown>,
  input: TInput,
  context: McpToolContext,
  correlationId: string,
  timeoutMs: number,
): Promise<AgentToolResult<unknown>> {
  await loadAgentRegistry()
  const agent = getAgent(spec.agentId)
  if (!agent) {
    throw new AgentToolError('AGENT_DISPATCHER_UNAVAILABLE', spec.agentId)
  }
  if (spec.requiredFeatures && !isAgentToolFeatureSuperset(spec.requiredFeatures, agent.requiredFeatures)) {
    throw new Error(
      `[internal] Agent tool "${spec.name}" requiredFeatures must cover every feature agent "${spec.agentId}" requires`,
    )
  }
  const decision = checkAgentPolicy({
    agentId: spec.agentId,
    authContext: { userFeatures: context.userFeatures, isSuperAdmin: context.isSuperAdmin },
    requestedExecutionMode: 'object',
  })
  if (!decision.ok) {
    throw new AgentToolError('AGENT_POLICY_DENIED', spec.agentId, decision.code)
  }
  const userId = context.userId
  if (!userId) {
    throw new AgentToolError('AGENT_POLICY_DENIED', spec.agentId, 'agent_principal_missing')
  }
  const prompt = spec.toPrompt ? spec.toPrompt(input) : defaultToPrompt(input)
  const channel = context.channel ?? 'agent'
  try {
    const outcome = await withTimeout(spec.name, timeoutMs, () =>
      runAiAgentObject({
        agentId: spec.agentId,
        input: prompt,
        authContext: {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          userId,
          features: context.userFeatures,
          isSuperAdmin: context.isSuperAdmin,
        },
        container: context.container,
        enableTools: true,
        sessionId: correlationId,
        channel,
        mutationMode: context.mutationMode,
        apiKeyId: resolveApiKeyId(context),
        correlationId,
        trace: { channel: toAgentRunChannel(context.channel), correlationId },
      }),
    )
    const object = outcome.mode === 'generate' ? outcome.object : await outcome.object
    const agentValidated = validateAgainst(agent.output?.schema, object, spec.name)
    return {
      result: validateAgainst(spec.outputSchema, agentValidated, spec.name),
      agentId: spec.agentId,
      runId: outcome.runId ?? null,
      agentRunId: null,
    }
  } catch (error) {
    if (error instanceof AgentPolicyError) {
      throw new AgentToolError('AGENT_POLICY_DENIED', spec.agentId, error.code)
    }
    throw error
  }
}

export function defineAgentTool<TInput, TOutput = unknown>(
  spec: DefineAgentToolSpec<TInput, TOutput>,
): AiToolDefinition<TInput, AgentToolResult<TOutput>> {
  const timeoutMs = spec.timeoutMs ?? AGENT_TOOL_DEFAULT_TIMEOUT_MS
  const explicitFeatures = spec.requiredFeatures ? [...spec.requiredFeatures] : undefined
  const handler = async (input: TInput, context: McpToolContext): Promise<AgentToolResult<TOutput>> => {
    const correlationId = resolveCorrelationId(context)
    const genericSpec = spec as DefineAgentToolSpec<TInput, unknown>
    const dispatcher = resolveAiAgentRunDispatcher(context.container)
    const outcome =
      dispatcher && dispatcher.owns(spec.agentId)
        ? await runThroughDispatcher(dispatcher, genericSpec, input, context, correlationId, timeoutMs)
        : await runThroughAiAssistant(genericSpec, input, context, correlationId, timeoutMs)
    return outcome as AgentToolResult<TOutput>
  }
  const tool: AiToolDefinition<TInput, AgentToolResult<TOutput>> = {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    isMutation: false,
    tags: ['agent'],
    agentRef: { agentId: spec.agentId, engine: 'ai-assistant' },
    mcp: { outputSchema: buildAgentToolOutputSchema(spec.outputSchema) },
    handler,
  }
  if (explicitFeatures) tool.requiredFeatures = explicitFeatures
  return tool
}
