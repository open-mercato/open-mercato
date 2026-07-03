import { NextResponse, type NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { loadAgentRegistry } from '../../../lib/agent-registry'
import { checkAgentPolicy, type AgentPolicyDenyCode } from '../../../lib/agent-policy'
import {
  runAiAgentText,
  resolveLoopBudgetPreset,
  type AiAgentLoopBudgetPreset,
} from '../../../lib/agent-runtime'
import { AgentPolicyError } from '../../../lib/agent-tools'
import { readBaseurlAllowlist, isBaseurlAllowlisted } from '../../../lib/baseurl-allowlist'
import {
  canonicalProviderId,
  hasAllowlistSnapshotRestrictions,
  intersectEffectiveAllowlistWithSnapshot,
  intersectAllowlists,
  isModelAllowedForProviderInEffective,
  isProviderAllowedInEffective,
  modelAllowlistEnvVarName,
  readAgentRuntimeOverrideAllowlist,
  type TenantAllowlistSnapshot,
} from '../../../lib/model-allowlist'
import { AiTenantModelAllowlistRepository } from '../../../data/repositories/AiTenantModelAllowlistRepository'
import { AiAgentRuntimeOverrideRepository } from '../../../data/repositories/AiAgentRuntimeOverrideRepository'
import { createConversationStorage } from '../../../lib/conversation-storage'
import { checkAiChatRateLimit } from '../../../lib/rate-limit'
import type { EntityManager } from '@mikro-orm/postgresql'

const MAX_MESSAGES = 100

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const chatMessageSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  uiParts: z.array(z.unknown()).optional(),
  files: z
    .array(
      z
        .object({
          id: z.string().optional(),
          name: z.string().optional(),
          type: z.string().optional(),
          mimeType: z.string().optional(),
          size: z.number().optional(),
        })
        .passthrough(),
    )
    .optional(),
})

const pageContextSchema = z
  .object({
    pageId: z.string().nullable().optional(),
    entityType: z.string().nullable().optional(),
    recordId: z.string().nullable().optional(),
  })
  .passthrough()

const chatRequestSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1, 'messages must contain at least one message')
    .max(MAX_MESSAGES, `messages must contain at most ${MAX_MESSAGES} entries`),
  attachmentIds: z.array(z.string()).optional(),
  debug: z.boolean().optional(),
  pageContext: pageContextSchema.optional(),
  /**
   * Stable per-conversation id (Phase 6.2). Wins over `conversationId` when
   * both are provided. The server echoes the resolved id on the SSE
   * `loop-finish` event so clients can persist it for the next turn.
   */
  sessionId: z.string().uuid().optional(),
  /**
   * @deprecated Use `sessionId` instead.
   */
  conversationId: z.string().min(1).max(128).optional(),
})

export type AiChatRequest = z.infer<typeof chatRequestSchema>

const agentQuerySchema = z.object({
  agent: z
    .string()
    .regex(agentIdPattern, 'agent must match "<module>.<agent>" (lowercase, digits, underscores only)'),
  /**
   * Per-request provider override. Must match a registered + configured
   * provider id. Validated against `llmProviderRegistry` at dispatch time.
   * Rejected when the agent has `allowRuntimeOverride: false`.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  provider: z.string().optional(),
  /**
   * Per-request model id override. Free-form string. Logged (not rejected)
   * when not in the provider's curated `defaultModels` catalog.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  model: z.string().optional(),
  /**
   * Per-request base URL override. Must parse as a URL and match
   * `AI_RUNTIME_BASEURL_ALLOWLIST` (comma-separated host patterns). When the
   * env var is unset or empty, any non-empty value is rejected.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  baseUrl: z.string().optional(),
  /**
   * Named loop-budget preset. Maps to a fixed `loop.budget` triple:
   *   tight   → maxSteps: 3,  maxWallClockMs: 10_000,  maxTokens:  50_000
   *   default → no override (agent default applies)
   *   loose   → maxSteps: 20, maxWallClockMs: 120_000, maxTokens: 500_000
   *
   * Rejected when the agent has `allowRuntimeOverride: false` or
   * `loop.allowRuntimeOverride: false`.
   *
   * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  loopBudget: z.enum(['tight', 'default', 'loose']).optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI agent dispatcher',
  methods: {
    POST: {
      operationId: 'aiAssistantChatAgent',
      summary: 'Stream a chat turn for a registered AI agent',
      description:
        'Dispatches a chat turn to the focused AI agent identified by `?agent=<module>.<agent>`. ' +
        'Enforces agent-level `requiredFeatures`, tool whitelisting, read-only / mutationPolicy, ' +
        'execution-mode compatibility, and attachment media-type policy. The streaming response ' +
        'body uses an AI SDK-compatible `text/event-stream` transport. ' +
        'Optional `?provider=`, `?model=`, and `?baseUrl=` query params let callers ' +
        'override the resolved provider/model/base-URL for this turn (Phase 4a). ' +
        'Provider must be registered and configured; baseUrl must match ' +
        '`AI_RUNTIME_BASEURL_ALLOWLIST` when set. Both are suppressed when the ' +
        'agent declares `allowRuntimeOverride: false`.',
      query: agentQuerySchema,
      requestBody: {
        contentType: 'application/json',
        description: 'Chat turn payload. `messages` is required; `attachmentIds`, `debug`, and `pageContext` are optional.',
        schema: chatRequestSchema,
      },
      responses: [
        { status: 200, description: 'Streaming text/event-stream response compatible with AI SDK chat transports.', mediaType: 'text/event-stream' },
      ],
      errors: [
        {
          status: 400,
          description:
            'Invalid query param, malformed payload, or message count above the cap. ' +
            'Typed codes: `runtime_override_disabled` (agent has allowRuntimeOverride:false), ' +
            '`provider_unknown` (provider id not registered), ' +
            '`provider_not_configured` (provider registered but no API key in env), ' +
            '`baseurl_not_allowlisted` (baseUrl not in AI_RUNTIME_BASEURL_ALLOWLIST).',
        },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks agent-level or tool-level required features.' },
        { status: 404, description: 'Unknown agent id.' },
        { status: 409, description: 'Agent/tool/execution-mode policy violation.' },
        { status: 500, description: 'Internal runtime failure.' },
      ],
    },
  },
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

function statusForDenyCode(code: AgentPolicyDenyCode): number {
  switch (code) {
    case 'agent_unknown':
      return 404
    case 'agent_features_denied':
    case 'tool_features_denied':
      return 403
    case 'tool_not_whitelisted':
    case 'tool_unknown':
    case 'mutation_blocked_by_readonly':
    case 'mutation_blocked_by_policy':
    case 'execution_mode_not_supported':
      return 409
    case 'attachment_type_not_accepted':
      return 400
    default:
      return 409
  }
}

function extractDataPayload(eventBlock: string): string | null {
  const dataLines = eventBlock
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => (line.startsWith('data: ') ? line.slice(6) : line.slice(5)))
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

function extractUiPartsFromToolOutput(output: unknown): unknown[] {
  let parsed = output
  if (typeof output === 'string') {
    const trimmed = output.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return []
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const value = parsed as Record<string, unknown>
  const parts: unknown[] = []
  if (value.status === 'pending-confirmation' || value.status === 'awaiting-confirmation') {
    const pendingActionId =
      typeof value.pendingActionId === 'string' && value.pendingActionId.length > 0
        ? value.pendingActionId
        : null
    if (pendingActionId) {
      parts.push({
        componentId: 'mutation-preview-card',
        pendingActionId,
        payload: {
          pendingActionId,
          expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
          agentId:
            typeof value.agentId === 'string'
              ? value.agentId
              : typeof value.agent === 'string'
                ? value.agent
                : undefined,
          toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
        },
      })
    }
  }
  if (value.uiPart && typeof value.uiPart === 'object') parts.push(value.uiPart)
  if (Array.isArray(value.uiParts)) parts.push(...value.uiParts)
  return parts
}

function extractAssistantSnapshot(
  raw: string,
  contentType: string | null,
): { content: string; uiParts: unknown[] } {
  if (!contentType?.includes('event-stream')) {
    return { content: raw, uiParts: [] }
  }
  let content = ''
  const uiParts: unknown[] = []
  for (const block of raw.split('\n\n')) {
    const data = extractDataPayload(block)
    if (!data || data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
        content += parsed.delta
      } else if (parsed.type === 'text' && typeof parsed.content === 'string') {
        content += parsed.content
      } else if (parsed.type === 'tool-output-available') {
        uiParts.push(...extractUiPartsFromToolOutput(parsed.output))
      }
    } catch {
      // Ignore SSE comments and malformed provider chunks.
    }
  }
  return { content, uiParts }
}

async function persistChatTurnStart(input: {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  userId: string
  agentId: string
  conversationId: string | null
  pageContext?: Record<string, unknown>
  messages: AiChatRequest['messages']
  attachmentIds?: string[]
}): Promise<{ conversationId: string; userClientMessageId: string | null } | null> {
  if (!input.tenantId || !input.conversationId) return null
  const repo = createConversationStorage(input.container)
  const ctx = {
    tenantId: input.tenantId,
    organizationId: input.organizationId ?? null,
    userId: input.userId,
  }
  await repo.createOrGet(
    {
      conversationId: input.conversationId,
      agentId: input.agentId,
      pageContext: input.pageContext ?? null,
    },
    ctx,
  )
  const userMessage = [...input.messages].reverse().find((message) => message.role === 'user')
  if (!userMessage) return { conversationId: input.conversationId, userClientMessageId: null }
  await repo.appendMessage(
    input.conversationId,
    {
      clientMessageId: userMessage.id,
      role: 'user',
      content: userMessage.content,
      uiParts: userMessage.uiParts,
      attachmentIds: input.attachmentIds,
      files: userMessage.files?.map((file, index) => {
        const id = file.id ?? input.attachmentIds?.[index]
        const mimeType = file.mimeType ?? file.type
        return {
          ...(id ? { id } : {}),
          ...(file.name ? { name: file.name } : {}),
          ...(mimeType ? { mimeType } : {}),
          ...(typeof file.size === 'number' ? { size: file.size } : {}),
        }
      }),
    },
    ctx,
  )
  return {
    conversationId: input.conversationId,
    userClientMessageId: userMessage.id ?? null,
  }
}

function persistAssistantOnStreamCompletion(input: {
  response: Response
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string | null | undefined
  organizationId: string | null | undefined
  userId: string
  conversationId: string
  userClientMessageId: string | null
}): Response {
  if (!input.response.body || !input.tenantId) return input.response
  const tenantId = input.tenantId
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const decoder = new TextDecoder()
  const contentType = input.response.headers.get('content-type')

  async function pump(): Promise<void> {
    const reader = input.response.body!.getReader()
    let raw = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        raw += decoder.decode(value, { stream: true })
        await writer.write(value)
      }
      raw += decoder.decode()
      const assistant = extractAssistantSnapshot(raw, contentType)
      if (assistant.content.trim() || assistant.uiParts.length > 0) {
        const repo = createConversationStorage(input.container)
        await repo.appendMessage(
          input.conversationId,
          {
            clientMessageId: input.userClientMessageId
              ? `${input.userClientMessageId}:assistant`
              : undefined,
            role: 'assistant',
            content: assistant.content,
            uiParts: assistant.uiParts,
          },
          {
            tenantId,
            organizationId: input.organizationId ?? null,
            userId: input.userId,
          },
        )
      }
    } catch (error) {
      console.error('[AI Chat Agent] Conversation persistence failure:', error)
    } finally {
      reader.releaseLock()
      await writer.close().catch(() => undefined)
    }
  }

  void pump()
  return new Response(readable, {
    status: input.response.status,
    statusText: input.response.statusText,
    headers: input.response.headers,
  })
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  const requestUrl = new URL(req.url)
  const queryResult = agentQuerySchema.safeParse({
    agent: requestUrl.searchParams.get('agent') ?? undefined,
    provider: requestUrl.searchParams.get('provider') ?? undefined,
    model: requestUrl.searchParams.get('model') ?? undefined,
    baseUrl: requestUrl.searchParams.get('baseUrl') ?? undefined,
    loopBudget: requestUrl.searchParams.get('loopBudget') ?? undefined,
  })
  if (!queryResult.success) {
    return jsonError(400, 'Invalid or missing "agent" query parameter.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }
  const agentId = queryResult.data.agent
  const rawProvider = queryResult.data.provider
  const rawModel = queryResult.data.model
  const rawBaseUrl = queryResult.data.baseUrl
  const rawLoopBudget = queryResult.data.loopBudget as AiAgentLoopBudgetPreset | undefined

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'validation_error')
  }

  const bodyResult = chatRequestSchema.safeParse(parsedBody)
  if (!bodyResult.success) {
    return jsonError(400, 'Invalid request body.', 'validation_error', {
      issues: bodyResult.error.issues,
    })
  }

  try {
    await loadAgentRegistry()

    const container = await createRequestContainer()
    const { locale } = await resolveTranslations()

    const rateLimited = await checkAiChatRateLimit({
      req,
      container,
      userId: auth.sub,
      tenantId: auth.tenantId,
    })
    if (rateLimited) return rateLimited

    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    const decision = checkAgentPolicy({
      agentId,
      authContext: {
        userFeatures: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
      },
      requestedExecutionMode: 'chat',
      // TODO(step-3.7): resolve attachmentIds -> media types via attachment-bridge
      // once the attachment-to-model conversion bridge lands. Until then the
      // policy gate skips attachment-type validation because media types are
      // not known at dispatch time.
      attachmentMediaTypes: undefined,
    })

    if (!decision.ok) {
      return jsonError(statusForDenyCode(decision.code), decision.message, decision.code)
    }

    const agentDef = decision.agent

    // --- Phase 4a: validate runtime override query params ---
    const hasRuntimeOverride =
      (rawProvider && rawProvider.trim().length > 0) ||
      (rawModel && rawModel.trim().length > 0) ||
      (rawBaseUrl && rawBaseUrl.trim().length > 0) ||
      (rawLoopBudget !== undefined && rawLoopBudget !== 'default')

    // `allowRuntimeOverride` is the canonical flag (renamed from
    // `allowRuntimeModelOverride` in Phase 4 of this spec). Both are checked
    // here to cover agents declared before the rename lands; the deprecated
    // alias has lower priority.
    const runtimeOverrideAllowed =
      agentDef.allowRuntimeOverride !== false &&
      agentDef.allowRuntimeModelOverride !== false

    if (hasRuntimeOverride && !runtimeOverrideAllowed) {
      return jsonError(
        400,
        `Agent "${agentId}" has runtime override disabled (allowRuntimeOverride: false).`,
        'runtime_override_disabled',
      )
    }

    let tenantAllowlistSnapshot: TenantAllowlistSnapshot | null = null
    let agentRuntimeOverrideAllowlist: TenantAllowlistSnapshot | null = null
    if (auth.tenantId) {
      try {
        const em = container.resolve<EntityManager>('em')
        const allowlistRepo = new AiTenantModelAllowlistRepository(em)
        tenantAllowlistSnapshot = await allowlistRepo.getSnapshot({
          tenantId: auth.tenantId,
          organizationId: auth.orgId ?? null,
        })
        const runtimeOverrideRepo = new AiAgentRuntimeOverrideRepository(em)
        const agentRuntimeOverrideRow = await runtimeOverrideRepo.getExact({
          tenantId: auth.tenantId,
          organizationId: auth.orgId ?? null,
          agentId,
        })
        const tenantAgentAllowlist = agentRuntimeOverrideRow
          ? {
              allowedProviders: agentRuntimeOverrideRow.allowedOverrideProviders ?? null,
              allowedModelsByProvider: agentRuntimeOverrideRow.allowedOverrideModelsByProvider ?? {},
            }
          : null
        agentRuntimeOverrideAllowlist = hasAllowlistSnapshotRestrictions(tenantAgentAllowlist)
          ? tenantAgentAllowlist
          : null
      } catch (snapshotError) {
        // Fail closed: refuse to dispatch if we cannot confirm the tenant allowlist.
        // Silently falling back to env-only would widen the effective allowlist when
        // the DB is unavailable, which is the opposite of what an admin intends.
        console.error(
          '[AI Chat Agent] Tenant allowlist lookup failed; refusing to dispatch:',
          snapshotError,
        )
        return jsonError(
          503,
          'Tenant allowlist is temporarily unavailable. Try again shortly.',
          'tenant_allowlist_unavailable',
        )
      }
    }
    const knownProviderIds = llmProviderRegistry.list().map((p) => p.id)
    const baseEffectiveAllowlist = intersectAllowlists(
      process.env as Record<string, string | undefined>,
      knownProviderIds,
      tenantAllowlistSnapshot,
    )
    const envAgentAllowlist = readAgentRuntimeOverrideAllowlist(
      process.env as Record<string, string | undefined>,
      agentId,
      knownProviderIds,
    )
    const effectiveAllowlist = intersectEffectiveAllowlistWithSnapshot(
      intersectEffectiveAllowlistWithSnapshot(
        baseEffectiveAllowlist,
        knownProviderIds,
        envAgentAllowlist,
      ),
      knownProviderIds,
      agentRuntimeOverrideAllowlist,
    )

    const normalizedProvider = rawProvider && rawProvider.trim().length > 0
      ? canonicalProviderId(rawProvider.trim(), llmProviderRegistry.list().map((p) => p.id))
      : null

    if (rawProvider && rawProvider.trim().length > 0) {
      const providerEntry = normalizedProvider ? llmProviderRegistry.get(normalizedProvider) : null
      if (!providerEntry) {
        return jsonError(
          400,
          `Provider "${rawProvider}" is not registered. Registered provider ids: ${llmProviderRegistry.list().map((p) => p.id).join(', ')}.`,
          'provider_unknown',
        )
      }
      if (!providerEntry.isConfigured()) {
        return jsonError(
          400,
          `Provider "${rawProvider}" is registered but not configured in this environment (missing API key).`,
          'provider_not_configured',
        )
      }
      if (!isProviderAllowedInEffective(effectiveAllowlist, normalizedProvider!)) {
        const source = effectiveAllowlist.tenantOverridesActive
          ? 'the effective allowlist (env ∩ tenant)'
          : 'OM_AI_AVAILABLE_PROVIDERS'
        return jsonError(
          400,
          `Provider "${rawProvider}" is not in ${source}.`,
          'provider_not_allowlisted',
        )
      }
      if (
        rawModel
        && rawModel.trim().length > 0
        && !isModelAllowedForProviderInEffective(
          effectiveAllowlist,
          normalizedProvider!,
          rawModel.trim(),
        )
      ) {
        const source = effectiveAllowlist.tenantOverridesActive
          ? `the effective allowlist (env ∩ tenant) for "${normalizedProvider}"`
          : modelAllowlistEnvVarName(normalizedProvider!)
        return jsonError(
          400,
          `Model "${rawModel}" is not in ${source}.`,
          'model_not_allowlisted',
        )
      }
    }

    if (rawBaseUrl && rawBaseUrl.trim().length > 0) {
      const allowlist = readBaseurlAllowlist()
      if (!isBaseurlAllowlisted(rawBaseUrl.trim(), allowlist)) {
        return jsonError(
          400,
          `baseUrl "${rawBaseUrl}" is not in the AI_RUNTIME_BASEURL_ALLOWLIST. Set that env var to a comma-separated list of allowed host patterns to enable per-request baseUrl overrides.`,
          'baseurl_not_allowlisted',
        )
      }
    }
    // --- end Phase 4a + Phase 4 validation ---

    const requestOverride =
      hasRuntimeOverride
        ? {
            providerId: normalizedProvider,
            modelId: rawModel && rawModel.trim().length > 0 ? rawModel.trim() : null,
            baseURL: rawBaseUrl && rawBaseUrl.trim().length > 0 ? rawBaseUrl.trim() : null,
          }
        : undefined

    // Resolve the loopBudget preset to a loop config override (Phase 4).
    const loopFromPreset =
      rawLoopBudget !== undefined && rawLoopBudget !== 'default'
        ? resolveLoopBudgetPreset(rawLoopBudget)
        : undefined

    const effectiveConversationId = bodyResult.data.sessionId ?? bodyResult.data.conversationId ?? null
    let persistedTurn:
      | { conversationId: string; userClientMessageId: string | null }
      | null = null
    try {
      persistedTurn = await persistChatTurnStart({
        container,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        agentId,
        conversationId: effectiveConversationId,
        pageContext: bodyResult.data.pageContext,
        messages: bodyResult.data.messages,
        attachmentIds: bodyResult.data.attachmentIds,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AiChatConversationOrgNotFoundError') {
        return jsonError(400, error.message, 'organization_not_found')
      }
      console.error('[AI Chat Agent] Failed to persist user message:', error)
    }

    const response = await runAiAgentText({
      agentId,
      messages: bodyResult.data.messages as unknown as UIMessage[],
      attachmentIds: bodyResult.data.attachmentIds,
      pageContext: bodyResult.data.pageContext,
      debug: bodyResult.data.debug,
      sessionId: bodyResult.data.sessionId ?? null,
      conversationId: bodyResult.data.conversationId ?? null,
      authContext: {
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        features: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
        locale,
      },
      container,
      requestOverride,
      loop: loopFromPreset,
      emitLoopTrace: true,
    })
    if (!persistedTurn) return response
    return persistAssistantOnStreamCompletion({
      response,
      container,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
      conversationId: persistedTurn.conversationId,
      userClientMessageId: persistedTurn.userClientMessageId,
    })
  } catch (error) {
    if (error instanceof AgentPolicyError) {
      return jsonError(statusForDenyCode(error.code), error.message, error.code)
    }
    console.error('[AI Chat Agent] Dispatch failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Agent dispatch failed.',
      'internal_error',
    )
  }
}
