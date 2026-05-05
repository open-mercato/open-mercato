import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
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
import type {
  AiChatRequestContext,
  AiResolvedAttachmentPart,
} from './attachment-bridge-types'
import { resolveAiAgentTools, AgentPolicyError } from './agent-tools'
import { resolveEffectiveMutationPolicy } from './agent-policy'
import { toolRegistry } from './tool-registry'
import {
  attachmentPartsToUiFileParts,
  resolveAttachmentPartsForAgent,
  summarizeAttachmentPartsForPrompt,
} from './attachment-parts'
import { AiAgentPromptOverrideRepository } from '../data/repositories/AiAgentPromptOverrideRepository'
import { AiAgentMutationPolicyOverrideRepository } from '../data/repositories/AiAgentMutationPolicyOverrideRepository'
import { composeSystemPromptWithOverride } from './prompt-override-merge'
import { isKnownMutationPolicy } from './agent-policy'
import type { AiAgentMutationPolicy } from './ai-agent-definition'

// Ensure built-in LLM providers are registered. Side-effect import; identical to
// what `./ai-sdk.ts` consumers already rely on.
import './llm-bootstrap'

export interface AgentRequestPageContext {
  pageId?: string | null
  entityType?: string | null
  recordId?: string | null
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
  /**
   * Optional stable chat-turn conversation id forwarded from `<AiChat>`.
   * Bridged into the Step 5.6 `prepareMutation` idempotency hash so repeated
   * turns within the same chat collapse onto the same pending action. When
   * omitted, the idempotency hash falls back to `null` which still preserves
   * per-tenant/org uniqueness within the TTL window.
   */
  conversationId?: string | null
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
      'No LLM provider is configured. Set OPENCODE_PROVIDER plus a matching API key such as ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY, then restart the app. See https://docs.openmercato.com/framework/ai-assistant/overview.',
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
  const baseFromOverride = await resolveBaseSystemPromptWithOverride(
    agent,
    container,
    tenantId,
    organizationId,
  )
  const resolve = agent.resolvePageContext
  if (!resolve) return baseFromOverride
  const entityType = pageContext?.entityType
  const recordId = pageContext?.recordId
  if (typeof entityType !== 'string' || entityType.length === 0) return baseFromOverride
  if (typeof recordId !== 'string' || recordId.length === 0) return baseFromOverride
  if (!container) {
    console.warn(
      `[AI Agents] Agent "${agent.id}" declares resolvePageContext but no container was passed to runAiAgentText; skipping hydration.`,
    )
    return baseFromOverride
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
      return `${baseFromOverride}\n\n${hydrated}`
    }
  } catch (error) {
    console.error(
      `[AI Agents] resolvePageContext for agent "${agent.id}" failed; continuing without hydration:`,
      error,
    )
  }
  return baseFromOverride
}

/**
 * Fetches the latest tenant-scoped prompt override for `agent` (if any) and
 * layers it onto the built-in `systemPrompt` via the additive merge helper.
 *
 * BC + fail-open: every failure mode — missing container, missing `em`
 * registration, repository throw, missing migration — is logged at `warn`
 * and falls back to `agent.systemPrompt`. A chat turn MUST never fail on
 * override lookup (per Step 5.3 spec: "If the repo call throws, log and
 * fall back to the built-in prompt — never fail the chat request").
 */
async function resolveBaseSystemPromptWithOverride(
  agent: AiAgentDefinition,
  container: AwilixContainer | undefined,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string> {
  const base = agent.systemPrompt
  if (!tenantId || !container) return base
  let em: EntityManager | null = null
  try {
    em = container.resolve<EntityManager>('em')
  } catch {
    em = null
  }
  if (!em) return base
  try {
    const repo = new AiAgentPromptOverrideRepository(em)
    const latest = await repo.getLatest(agent.id, {
      tenantId,
      organizationId: organizationId ?? null,
    })
    if (!latest || !latest.sections || Object.keys(latest.sections).length === 0) {
      return base
    }
    return composeSystemPromptWithOverride(base, { sections: latest.sections })
  } catch (error) {
    console.warn(
      `[AI Agents] Prompt-override lookup failed for agent "${agent.id}"; falling back to built-in prompt.`,
      error,
    )
    return base
  }
}

/**
 * Looks up the tenant-scoped `mutationPolicy` override for `agentId` (Step
 * 5.4). Fails SAFE: any repo error, missing container, missing `em`
 * registration, or corrupt enum value returns `null`, which causes the
 * runtime to fall back to the agent's code-declared policy. A chat turn
 * MUST never fail on override lookup.
 */
async function resolveMutationPolicyOverride(
  agentId: string,
  container: AwilixContainer | undefined,
  tenantId: string | null,
  organizationId: string | null,
): Promise<AiAgentMutationPolicy | null> {
  if (!tenantId || !container) return null
  let em: EntityManager | null = null
  try {
    em = container.resolve<EntityManager>('em')
  } catch {
    em = null
  }
  if (!em) return null
  try {
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const row = await repo.get(agentId, { tenantId, organizationId: organizationId ?? null })
    if (!row) return null
    const raw = row.mutationPolicy
    if (!isKnownMutationPolicy(raw)) {
      console.warn(
        `[AI Agents] Ignoring corrupt mutationPolicy override row for agent "${agentId}": "${raw}". Falling back to code-declared policy.`,
      )
      return null
    }
    return raw
  } catch (error) {
    console.warn(
      `[AI Agents] mutationPolicy override lookup failed for agent "${agentId}"; falling back to code-declared policy.`,
      error,
    )
    return null
  }
}

/**
 * Normalizes simple `{ role, content }` chat messages into the AI SDK
 * `UIMessage` shape that `convertToModelMessages` requires. When the
 * incoming message already carries a `parts` array it is left untouched;
 * otherwise a single `TextUIPart` is synthesized from `content`.
 */
function ensureUiMessageShape(messages: UIMessage[]): UIMessage[] {
  return messages.map((message, index) => {
    const raw = message as unknown as { id?: string; role?: string; content?: string; parts?: unknown[] }
    if (Array.isArray(raw.parts) && raw.parts.length > 0) {
      // Already has parts — only ensure `id` is present
      return { ...message, id: raw.id ?? `msg-${index}` } as UIMessage
    }
    const textContent = typeof raw.content === 'string' ? raw.content : ''
    return {
      id: raw.id ?? `msg-${index}`,
      role: raw.role ?? 'user',
      parts: [{ type: 'text', text: textContent }],
    } as unknown as UIMessage
  })
}

/**
 * Appends AI SDK v6 `FileUIPart` entries to the last user message in the
 * request so resolved attachment bytes / signed URLs reach the model. Pure
 * helper so chat-mode and object-mode share identical behavior — any
 * divergence here breaks the Step 3.6 parity contract.
 */
function attachAttachmentsToMessages(
  messages: UIMessage[],
  parts: readonly AiResolvedAttachmentPart[],
): UIMessage[] {
  if (parts.length === 0) return messages
  const fileParts = attachmentPartsToUiFileParts(parts)
  if (fileParts.length === 0) return messages
  const next = messages.slice()
  let lastUserIndex = -1
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const candidate = next[index] as unknown as { role?: string }
    if (candidate?.role === 'user') {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex === -1) {
    next.push({
      id: 'ai-runtime-attachments',
      role: 'user',
      parts: fileParts as unknown as UIMessage['parts'],
    } as unknown as UIMessage)
    return next
  }
  const source = next[lastUserIndex] as unknown as { parts?: unknown[] }
  const existingParts = Array.isArray(source.parts) ? source.parts : []
  next[lastUserIndex] = {
    ...(next[lastUserIndex] as object),
    parts: [...existingParts, ...fileParts],
  } as UIMessage
  return next
}

function appendAttachmentSummary(
  systemPrompt: string,
  parts: readonly AiResolvedAttachmentPart[],
): string {
  const summary = summarizeAttachmentPartsForPrompt(parts)
  if (!summary) return systemPrompt
  return `${systemPrompt}\n\n${summary}`
}

/**
 * Builds a runtime "MUTATION POLICY (RUNTIME)" block describing the
 * EFFECTIVE policy for this turn — what the model should expect when it
 * calls each whitelisted mutation tool. Generated dynamically because:
 *
 *   - the agent's static prompt cannot know which per-tenant override is
 *     in force (`destructive-confirm-required` flips most writes to
 *     run-direct) and would otherwise mislead the operator with stale
 *     "this requires approval" copy;
 *   - the per-tool `isDestructive` flag determines whether each
 *     whitelisted write goes through the approval card or runs inline.
 *
 * Without this block, the model parrots its hardcoded "always route
 * through the approval card" prompt language and tells the user "your
 * change is awaiting approval" when in fact the dispatcher already
 * applied the change directly. The injected block flips the model to
 * report results accurately ("applied", "pending your approval", or
 * "blocked because read-only") tool-by-tool.
 */
function buildRuntimeMutationPolicySection(
  agent: { id: string; mutationPolicy?: string | null; allowedTools: string[] },
  mutationPolicyOverride: string | null,
): string | null {
  const effective = resolveEffectiveMutationPolicy(
    (agent.mutationPolicy ?? null) as never,
    (mutationPolicyOverride ?? null) as never,
    agent.id,
  )
  const lines: string[] = []
  lines.push('MUTATION POLICY (RUNTIME)')
  lines.push(`Declared agent policy: ${agent.mutationPolicy ?? 'read-only'}.`)
  if (mutationPolicyOverride && mutationPolicyOverride !== agent.mutationPolicy) {
    lines.push(`Tenant override active: ${mutationPolicyOverride}.`)
  }
  lines.push(`Effective policy: ${effective}.`)

  // Bucket the agent's allowlisted tools into "gated" / "direct" / "conditional"
  // / "blocked" so the model can phrase outcomes correctly per tool.
  // `conditional` covers tools whose `isDestructive` is a predicate function:
  // their gate-vs-direct decision depends on the per-call input (e.g.
  // `customers.manage_deal_comment` gates only its delete branch under
  // `destructive-confirm-required`).
  const direct: string[] = []
  const gated: string[] = []
  const conditional: string[] = []
  const blocked: string[] = []
  for (const toolName of agent.allowedTools) {
    const tool = toolRegistry.getTool(toolName) as
      | { isMutation?: boolean; isDestructive?: boolean | ((input: unknown) => boolean) }
      | undefined
    if (!tool || tool.isMutation !== true) continue
    if (effective === 'read-only') {
      blocked.push(toolName)
      continue
    }
    if (effective === 'confirm-required') {
      gated.push(toolName)
      continue
    }
    // destructive-confirm-required
    if (typeof tool.isDestructive === 'function') {
      conditional.push(toolName)
    } else if (tool.isDestructive === true) {
      gated.push(toolName)
    } else {
      direct.push(toolName)
    }
  }

  if (
    direct.length === 0 &&
    gated.length === 0 &&
    conditional.length === 0 &&
    blocked.length === 0
  ) {
    // Read-only agent with no mutation tools — no runtime policy block needed.
    return null
  }
  if (direct.length > 0) {
    lines.push('')
    lines.push(
      `Tools that WILL RUN DIRECTLY (no approval card, no pending action) under the effective policy: ${direct.join(', ')}.`,
    )
    lines.push(
      'When you call any of these and the call returns successfully, the change has ALREADY BEEN APPLIED. Report it in the past tense ("Updated …", "Added …", "Created …"). Do NOT tell the operator the action is "pending your approval" or "awaiting confirmation" — that would be a false statement under the current policy.',
    )
  }
  if (gated.length > 0) {
    lines.push('')
    lines.push(
      `Tools that REQUIRE APPROVAL under the effective policy: ${gated.join(', ')}.`,
    )
    lines.push(
      'When you call any of these, the dispatcher returns an "awaiting confirmation" envelope and renders an inline approval card. Tell the operator the change is pending their confirmation; do NOT claim it has been applied.',
    )
  }
  if (conditional.length > 0) {
    lines.push('')
    lines.push(
      `Tools whose approval requirement DEPENDS ON THE INPUT under the effective policy: ${conditional.join(', ')}.`,
    )
    lines.push(
      'These multi-operation tools gate ONLY the destructive branches (typically `operation: "delete"` or similar). Read the tool result envelope: if it carries `status: "pending-confirmation"` then the change is pending — tell the operator it needs their approval. If it carries direct success data, the change has ALREADY BEEN APPLIED — report it in the past tense. Never assume one branch behaves like another.',
    )
  }
  if (blocked.length > 0) {
    lines.push('')
    lines.push(
      `Tools that are BLOCKED under the effective policy (read-only): ${blocked.join(', ')}.`,
    )
    lines.push(
      'Calls to these tools are refused before the handler runs. Do not attempt them; instead direct the operator to the matching backoffice page or to switch the tenant policy if they have permission.',
    )
  }
  lines.push('')
  lines.push(
    'This RUNTIME policy block always wins over any conflicting "approval card" language earlier in the prompt — the static prompt is written for the most restrictive case but real behavior depends on the per-call policy described here.',
  )
  return lines.join('\n')
}

function appendRuntimeMutationPolicy(
  systemPrompt: string,
  agent: { id: string; mutationPolicy?: string | null; allowedTools: string[] },
  mutationPolicyOverride: string | null,
): string {
  const block = buildRuntimeMutationPolicySection(agent, mutationPolicyOverride)
  if (!block) return systemPrompt
  return `${systemPrompt}\n\n${block}`
}

/**
 * Server-side helper that runs an Open Mercato agent in chat mode via the
 * Vercel AI SDK and returns a streaming `Response` ready to be emitted from a
 * route handler. Shares the same policy gate and tool resolution path as the
 * HTTP dispatcher — a caller using this helper can never bypass the agent's
 * `requiredFeatures`, `allowedTools`, `executionMode`, or `mutationPolicy`.
 *
 * Attachment-to-model conversion (Step 3.7): resolved
 * {@link AiResolvedAttachmentPart}s are materialized inline as AI SDK v6
 * `FileUIPart` entries on the last user message (images/PDFs) and as a
 * structured `[ATTACHMENTS]` block appended to the system prompt (text
 * extracts + metadata-only summaries). The existing `attachmentIds`
 * pass-through into `resolveAiAgentTools` is preserved — Step 3.6 parity
 * invariant #7 still holds.
 */
export async function runAiAgentText(input: RunAiAgentTextInput): Promise<Response> {
  const mutationPolicyOverride = await resolveMutationPolicyOverride(
    input.agentId,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )
  const { agent, tools } = await resolveAiAgentTools({
    agentId: input.agentId,
    authContext: input.authContext,
    pageContext: input.pageContext,
    attachmentIds: input.attachmentIds,
    mutationPolicyOverride,
    container: input.container,
    conversationId: input.conversationId ?? null,
  })

  const resolvedAttachments = await resolveAttachmentPartsForAgent({
    agent,
    attachmentIds: input.attachmentIds,
    authContext: input.authContext,
    container: input.container,
  })

  const baseSystemPrompt = await composeSystemPrompt(
    agent,
    input.pageContext,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )
  const systemPrompt = appendRuntimeMutationPolicy(
    appendAttachmentSummary(baseSystemPrompt, resolvedAttachments),
    agent,
    mutationPolicyOverride,
  )

  const { model } = resolveAgentModel(agent, input.modelOverride)
  const normalizedMessages = ensureUiMessageShape(input.messages)
  const hydratedMessages = attachAttachmentsToMessages(normalizedMessages, resolvedAttachments)
  const modelMessages = await convertToModelMessages(hydratedMessages)
  // Default to 10 agentic steps when the agent does not declare maxSteps.
  // Without stopWhen the AI SDK runs a single model call and never executes
  // tool calls, which makes every tool-using query return an empty stream.
  const effectiveMaxSteps = typeof agent.maxSteps === 'number' && agent.maxSteps > 0
    ? agent.maxSteps
    : 10
  const stopWhen = stepCountIs(effectiveMaxSteps)

  const streamArgs: Parameters<typeof streamText>[0] = {
    model,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen,
  }

  const result = streamText(streamArgs)
  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    headers: {
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
 * Attachment-to-model conversion (Step 3.7): resolved
 * {@link AiResolvedAttachmentPart}s are materialized inline as AI SDK v6
 * `FileUIPart` entries on the last user message (images/PDFs) and as a
 * structured `[ATTACHMENTS]` block appended to the system prompt (text
 * extracts + metadata-only summaries). Matches {@link runAiAgentText} byte-
 * for-byte so the Step 3.6 parity contract is preserved.
 */
export async function runAiAgentObject<TSchema = unknown>(
  input: RunAiAgentObjectInput<TSchema>,
): Promise<RunAiAgentObjectResult<TSchema>> {
  const mutationPolicyOverride = await resolveMutationPolicyOverride(
    input.agentId,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )
  const { agent, tools } = await resolveAiAgentTools({
    agentId: input.agentId,
    authContext: input.authContext,
    pageContext: input.pageContext,
    attachmentIds: input.attachmentIds,
    requestedExecutionMode: 'object',
    mutationPolicyOverride,
    container: input.container,
  })

  const resolvedOutput = resolveStructuredOutput(agent, input.output)

  const resolvedAttachments = await resolveAttachmentPartsForAgent({
    agent,
    attachmentIds: input.attachmentIds,
    authContext: input.authContext,
    container: input.container,
  })

  const baseSystemPrompt = await composeSystemPrompt(
    agent,
    input.pageContext,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )
  const systemPrompt = appendRuntimeMutationPolicy(
    appendAttachmentSummary(baseSystemPrompt, resolvedAttachments),
    agent,
    mutationPolicyOverride,
  )

  const { model } = resolveAgentModel(agent, input.modelOverride)
  const normalizedMessages = ensureUiMessageShape(normalizeObjectMessages(input.input))
  const hydratedMessages = attachAttachmentsToMessages(
    normalizedMessages,
    resolvedAttachments,
  )
  const modelMessages = await convertToModelMessages(hydratedMessages)
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
