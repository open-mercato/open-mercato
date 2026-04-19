import { NextResponse, type NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { loadAgentRegistry } from '../../../lib/agent-registry'
import { checkAgentPolicy, type AgentPolicyDenyCode } from '../../../lib/agent-policy'
import { runAiAgentText } from '../../../lib/agent-runtime'
import { AgentPolicyError } from '../../../lib/agent-tools'

const MAX_MESSAGES = 100

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})

const pageContextSchema = z
  .object({
    pageId: z.string().optional(),
    entityType: z.string().optional(),
    recordId: z.string().optional(),
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
        'body uses an AI SDK-compatible `text/event-stream` transport.',
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
        { status: 400, description: 'Invalid query param, malformed payload, or message count above the cap.' },
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
  })
  if (!queryResult.success) {
    return jsonError(400, 'Invalid or missing "agent" query parameter.', 'validation_error', {
      issues: queryResult.error.issues,
    })
  }
  const agentId = queryResult.data.agent

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
