import { NextResponse, type NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { loadAgentRegistry } from '../../../lib/agent-registry'
import { checkAgentPolicy, type AgentPolicyDenyCode } from '../../../lib/agent-policy'
import { runAiAgentText } from '../../../lib/agent-runtime'
import { AgentPolicyError } from '../../../lib/agent-tools'
import { readBaseurlAllowlist, isBaseurlAllowlisted } from '../../../lib/baseurl-allowlist'
import { isProviderAllowed, isProviderModelAllowed } from '../../../lib/model-allowlist'

const MAX_MESSAGES = 100

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
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
   * Optional stable conversation id forwarded from `<AiChat>`. Bridged into
   * the Step 5.6 `prepareMutation` idempotency hash so repeated turns within
   * the same chat collapse onto the same pending action. Additive; omitted
   * bodies continue to work as before.
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
   * Rejected when the agent has `allowRuntimeModelOverride: false`.
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
        'agent declares `allowRuntimeModelOverride: false`.',
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
            'Typed codes: `runtime_override_disabled` (agent has allowRuntimeModelOverride:false), ' +
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
      (rawBaseUrl && rawBaseUrl.trim().length > 0)

    if (hasRuntimeOverride) {
      if (agentDef.allowRuntimeModelOverride === false) {
        return jsonError(
          400,
          `Agent "${agentId}" has runtime model override disabled (allowRuntimeModelOverride: false).`,
          'runtime_override_disabled',
        )
      }
    }

    if (rawProvider && rawProvider.trim().length > 0) {
      const providerEntry = llmProviderRegistry.get(rawProvider.trim())
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
      if (!isProviderAllowed(process.env, rawProvider.trim())) {
        return jsonError(
          400,
          `Provider "${rawProvider}" is not in OM_AI_AVAILABLE_PROVIDERS.`,
          'provider_not_allowlisted',
        )
      }
      if (
        rawModel
        && rawModel.trim().length > 0
        && !isProviderModelAllowed(process.env, rawProvider.trim(), rawModel.trim())
      ) {
        return jsonError(
          400,
          `Model "${rawModel}" is not in OM_AI_AVAILABLE_MODELS_${rawProvider.trim().toUpperCase()}.`,
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
    // --- end Phase 4a validation ---

    const requestOverride =
      hasRuntimeOverride
        ? {
            providerId: rawProvider && rawProvider.trim().length > 0 ? rawProvider.trim() : null,
            modelId: rawModel && rawModel.trim().length > 0 ? rawModel.trim() : null,
            baseURL: rawBaseUrl && rawBaseUrl.trim().length > 0 ? rawBaseUrl.trim() : null,
          }
        : undefined

    return await runAiAgentText({
      agentId,
      messages: bodyResult.data.messages as unknown as UIMessage[],
      attachmentIds: bodyResult.data.attachmentIds,
      pageContext: bodyResult.data.pageContext,
      debug: bodyResult.data.debug,
      conversationId: bodyResult.data.conversationId ?? null,
      authContext: {
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        features: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
      },
      container,
      requestOverride,
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
