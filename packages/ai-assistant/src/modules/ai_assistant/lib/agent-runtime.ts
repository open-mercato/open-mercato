import type { AwilixContainer } from 'awilix'
import type { LanguageModel, UIMessage } from 'ai'
import {
  convertToModelMessages,
  generateObject,
  stepCountIs,
  streamObject,
  streamText,
} from 'ai'
import type { ZodTypeAny } from 'zod'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import type {
  AiAgentDefinition,
  AiAgentPageContextInput,
  AiAgentStructuredOutput,
} from './ai-agent-definition'
import type { AiChatRequestContext } from './attachment-bridge-types'
import { resolveAiAgentTools, AgentPolicyError } from './agent-tools'

// Ensure built-in LLM providers are registered. Side-effect import; identical to
// what `./ai-sdk.ts` consumers already rely on.
import './llm-bootstrap'

export interface AgentRequestPageContext {
  pageId?: string
  entityType?: string
  recordId?: string
  [key: string]: unknown
}

export interface RunAiAgentTextInput {
  agentId: string
  messages: UIMessage[]
  attachmentIds?: string[]
  pageContext?: AgentRequestPageContext
  debug?: boolean
  /**
   * Phase 1 exposes the caller-supplied auth context directly on the helper
   * input. Phase 4 may wrap this behind a thinner public API once a global
   * request-context resolver exists. Helpers running inside the HTTP
   * dispatcher receive the same `AiChatRequestContext` used by `checkAgentPolicy`.
   */
  authContext: AiChatRequestContext
  /**
   * Optional per-call model id override that wins over `agent.defaultModel`.
   * The production model-factory extraction lives in Step 5.1; this Step
   * accepts a literal model id string so the Phase 1 runtime already honors
   * `agent.defaultModel` without inventing a new indirection layer.
   */
  modelOverride?: string
  /**
   * Optional DI container used by `resolvePageContext` callbacks. When omitted
   * and the agent declares a `resolvePageContext`, hydration is skipped with a
   * warning (callbacks that need database/DI cannot run safely without one).
   */
  container?: AwilixContainer
}

interface ResolvedAgentModel {
  model: LanguageModel
  modelId: string
  providerId: string
}

function resolveAgentModel(
  agent: AiAgentDefinition,
  modelOverride: string | undefined,
): ResolvedAgentModel {
  const provider = llmProviderRegistry.resolveFirstConfigured()
  if (!provider) {
    throw new Error(
      'No LLM provider is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY and retry.',
    )
  }
  const apiKey = provider.resolveApiKey()
  if (!apiKey) {
    throw new Error(
      `LLM provider "${provider.id}" is advertised as configured but resolveApiKey() returned empty.`,
    )
  }
  const modelId =
    (modelOverride && modelOverride.trim().length > 0 ? modelOverride : undefined) ??
    agent.defaultModel ??
    provider.defaultModel
  const model = provider.createModel({ modelId, apiKey }) as LanguageModel
  return { model, modelId, providerId: provider.id }
}

/**
 * Composes the effective system prompt for a run. When the agent declares a
 * `resolvePageContext` callback AND the incoming request carries both
 * `entityType` and `recordId`, the callback is invoked and its return value
 * is appended to `agent.systemPrompt`. Throwing callbacks are caught and
 * logged without failing the request — the spec allows hydration to be
 * best-effort until Step 5.2 wires a stricter contract.
 */
export async function composeSystemPrompt(
  agent: AiAgentDefinition,
  pageContext: AgentRequestPageContext | undefined,
  container: AwilixContainer | undefined,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string> {
  const base = agent.systemPrompt
  const resolve = agent.resolvePageContext
  if (!resolve) return base
  const entityType = pageContext?.entityType
  const recordId = pageContext?.recordId
  if (typeof entityType !== 'string' || entityType.length === 0) return base
  if (typeof recordId !== 'string' || recordId.length === 0) return base
  if (!container) {
    console.warn(
      `[AI Agents] Agent "${agent.id}" declares resolvePageContext but no container was passed to runAiAgentText; skipping hydration.`,
    )
    return base
  }
  const hydrationInput: AiAgentPageContextInput = {
    entityType,
    recordId,
    container,
    tenantId,
    organizationId,
  }
  try {
    const hydrated = await resolve(hydrationInput)
    if (typeof hydrated === 'string' && hydrated.trim().length > 0) {
      return `${base}\n\n${hydrated}`
    }
  } catch (error) {
    console.error(
      `[AI Agents] resolvePageContext for agent "${agent.id}" failed; continuing without hydration:`,
      error,
    )
  }
  return base
}

/**
 * Server-side helper that runs an Open Mercato agent in chat mode via the
 * Vercel AI SDK and returns a streaming `Response` ready to be emitted from a
 * route handler. Shares the same policy gate and tool resolution path as the
 * HTTP dispatcher — a caller using this helper can never bypass the agent's
 * `requiredFeatures`, `allowedTools`, `executionMode`, or `mutationPolicy`.
 *
 * Structured-output mode (`executionMode: 'object'`) lands in Step 3.5 via
 * `runAiAgentObject`. Attachment-to-model conversion lands in Step 3.7 — this
 * helper accepts `attachmentIds` and passes them through to the tool-resolver
 * but does not yet materialize them into model parts.
 */
export async function runAiAgentText(input: RunAiAgentTextInput): Promise<Response> {
  const { agent, tools } = await resolveAiAgentTools({
    agentId: input.agentId,
    authContext: input.authContext,
    pageContext: input.pageContext,
    // TODO(step-3.7): pass resolved attachment media types to the policy gate
    // once the attachment-to-model bridge lands. Until then the tool resolver
    // relays ids untouched and the policy gate skips the attachment branch.
    attachmentIds: input.attachmentIds,
  })

  const systemPrompt = await composeSystemPrompt(
    agent,
    input.pageContext,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )

  const { model } = resolveAgentModel(agent, input.modelOverride)
  const modelMessages = await convertToModelMessages(input.messages)
  const stopWhen = typeof agent.maxSteps === 'number' && agent.maxSteps > 0
    ? stepCountIs(agent.maxSteps)
    : undefined

  const streamArgs: Parameters<typeof streamText>[0] = {
    model,
    system: systemPrompt,
    messages: modelMessages,
    tools,
  }
  if (stopWhen) {
    streamArgs.stopWhen = stopWhen
  }

  const result = streamText(streamArgs)
  return result.toTextStreamResponse({
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Runtime override for the structured-output schema used by {@link runAiAgentObject}.
 * When the agent itself declares no `output` block, the caller MUST supply this;
 * otherwise the helper rejects with {@link AgentPolicyError} code
 * `execution_mode_not_supported`.
 */
export interface RunAiAgentObjectOutputOverride<TSchema = ZodTypeAny> {
  schemaName: string
  schema: TSchema
  /**
   * `'generate'` (default) calls AI SDK `generateObject` and resolves to the
   * parsed object. `'stream'` calls `streamObject` and returns the SDK's
   * streaming handle so callers can consume partial objects / text deltas.
   */
  mode?: 'generate' | 'stream'
}

export interface RunAiAgentObjectInput<TSchema = ZodTypeAny> {
  agentId: string
  /**
   * Accepts either a bare user prompt (wrapped as `[{ role: 'user', content }]`)
   * or a prebuilt `UIMessage[]` array — matches the source spec's
   * `RunAiAgentObjectInput` contract (§1149–1160).
   */
  input: string | UIMessage[]
  attachmentIds?: string[]
  pageContext?: AgentRequestPageContext
  /**
   * Same Phase-1 shim as {@link RunAiAgentTextInput.authContext}. Required until
   * a global request-context resolver lands (Phase 4).
   */
  authContext: AiChatRequestContext
  modelOverride?: string
  output?: RunAiAgentObjectOutputOverride<TSchema>
  debug?: boolean
  container?: AwilixContainer
}

export type RunAiAgentObjectGenerateResult<TSchema> = {
  mode: 'generate'
  object: TSchema
  finishReason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

export type RunAiAgentObjectStreamResult<TSchema> = {
  mode: 'stream'
  /** Full parsed object once the stream completes. */
  object: Promise<TSchema>
  /** Async iterator of partial (progressively hydrated) objects. */
  partialObjectStream: AsyncIterable<Partial<TSchema>>
  /** Async iterator of the raw text deltas the model emitted. */
  textStream: AsyncIterable<string>
  finishReason?: Promise<string | undefined>
  usage?: Promise<{ inputTokens?: number; outputTokens?: number } | undefined>
}

export type RunAiAgentObjectResult<TSchema> =
  | RunAiAgentObjectGenerateResult<TSchema>
  | RunAiAgentObjectStreamResult<TSchema>

function normalizeObjectMessages(input: string | UIMessage[]): UIMessage[] {
  if (typeof input === 'string') {
    return [
      {
        id: 'user-input',
        role: 'user',
        parts: [{ type: 'text', text: input }],
      } as unknown as UIMessage,
    ]
  }
  return input
}

function resolveStructuredOutput<TSchema>(
  agent: AiAgentDefinition,
  override: RunAiAgentObjectOutputOverride<TSchema> | undefined,
): { schemaName: string; schema: unknown; mode: 'generate' | 'stream' } {
  if (override) {
    return {
      schemaName: override.schemaName,
      schema: override.schema as unknown,
      mode: override.mode ?? 'generate',
    }
  }
  const declared = agent.output as AiAgentStructuredOutput | undefined
  if (!declared) {
    throw new AgentPolicyError(
      'execution_mode_not_supported',
      `Agent "${agent.id}" does not declare a structured-output schema; pass runAiAgentObject({ output }) or declare agent.output.`,
    )
  }
  return {
    schemaName: declared.schemaName,
    schema: declared.schema as unknown,
    mode: declared.mode ?? 'generate',
  }
}

/**
 * Server-side helper that runs an Open Mercato agent in structured-output mode
 * via the Vercel AI SDK. Shares the same policy gate, tool resolution path,
 * system-prompt composition, and model resolution as {@link runAiAgentText} —
 * object-mode and chat-mode CANNOT diverge.
 *
 * Attachment-to-model conversion is Step 3.7 — attachment ids are passed
 * through to the tool resolver but not yet materialized into model parts.
 */
export async function runAiAgentObject<TSchema = unknown>(
  input: RunAiAgentObjectInput<TSchema>,
): Promise<RunAiAgentObjectResult<TSchema>> {
  const { agent, tools } = await resolveAiAgentTools({
    agentId: input.agentId,
    authContext: input.authContext,
    pageContext: input.pageContext,
    attachmentIds: input.attachmentIds,
    requestedExecutionMode: 'object',
  })

  const resolvedOutput = resolveStructuredOutput(agent, input.output)

  const systemPrompt = await composeSystemPrompt(
    agent,
    input.pageContext,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )

  const { model } = resolveAgentModel(agent, input.modelOverride)
  const modelMessages = await convertToModelMessages(normalizeObjectMessages(input.input))
  const stopWhen = typeof agent.maxSteps === 'number' && agent.maxSteps > 0
    ? stepCountIs(agent.maxSteps)
    : undefined

  if (resolvedOutput.mode === 'stream') {
    const streamArgs: Parameters<typeof streamObject>[0] = {
      model,
      system: systemPrompt,
      messages: modelMessages,
      schema: resolvedOutput.schema as never,
      schemaName: resolvedOutput.schemaName,
    }
    const result = streamObject(streamArgs) as unknown as {
      object: Promise<TSchema>
      partialObjectStream: AsyncIterable<Partial<TSchema>>
      textStream: AsyncIterable<string>
      finishReason?: Promise<string | undefined>
      usage?: Promise<{ inputTokens?: number; outputTokens?: number } | undefined>
    }
    return {
      mode: 'stream',
      object: result.object,
      partialObjectStream: result.partialObjectStream,
      textStream: result.textStream,
      finishReason: result.finishReason,
      usage: result.usage,
    }
  }

  const generateArgs: Parameters<typeof generateObject>[0] = {
    model,
    system: systemPrompt,
    messages: modelMessages,
    schema: resolvedOutput.schema as never,
    schemaName: resolvedOutput.schemaName,
  }
  if (stopWhen) {
    // generateObject shares `CallSettings` with generateText; stopWhen is ignored
    // by the typed surface but harmless for providers that respect it. Tools
    // flow through the system prompt only in object mode today — the whitelist
    // has already been resolved via `resolveAiAgentTools` above, even if we
    // don't hand it to generateObject.
    ;(generateArgs as Record<string, unknown>).stopWhen = stopWhen
  }
  void tools

  const result = await generateObject(generateArgs)
  return {
    mode: 'generate',
    object: (result as { object: unknown }).object as TSchema,
    finishReason: (result as { finishReason?: string }).finishReason,
    usage: (result as { usage?: { inputTokens?: number; outputTokens?: number } }).usage,
  }
}

export { AgentPolicyError }
