import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getAgent, loadAgentRegistry } from '../../../lib/agent-registry'
import { checkAgentPolicy, type AgentPolicyDenyCode } from '../../../lib/agent-policy'
import { runAiAgentObject } from '../../../lib/agent-runtime'
import { AgentPolicyError } from '../../../lib/agent-tools'
import { aiAgentHttpCallSettingsSchema } from '../../../lib/agent-call-contract'
import { CORRELATION_ID_HEADER, resolveCorrelationId } from '../../../lib/mcp-audit'
import {
  isAiAgentDispatchDeniedError,
  resolveAiAgentRunDispatcher,
  resolveDispatchOwner,
  type AiAgentRunDispatchCaller,
  type AiAgentRunDispatcher,
} from '../../../lib/agent-run-dispatcher'

const logger = createLogger('ai_assistant')

const MAX_MESSAGES = 100

const DISPATCH_TIMEOUT_MS = 120_000

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const agentIdSchema = z
  .string()
  .regex(agentIdPattern, 'agent must match "<module>.<agent>" (lowercase, digits, underscores only)')

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

const runObjectRequestSchema = z.object({
  agent: agentIdSchema,
  messages: z
    .array(chatMessageSchema)
    .min(1, 'messages must contain at least one message')
    .max(MAX_MESSAGES, `messages must contain at most ${MAX_MESSAGES} entries`),
  attachmentIds: z.array(z.string()).optional(),
  pageContext: pageContextSchema.optional(),
  modelOverride: z.string().optional(),
  callSettings: aiAgentHttpCallSettingsSchema.optional(),
})

const runObjectResponseSchema = z.object({
  runId: z.string().uuid().nullable(),
  agentRunId: z.string().nullable().optional(),
  object: z.unknown(),
  finishReason: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    })
    .optional(),
})

export type AiRunObjectRequest = z.infer<typeof runObjectRequestSchema>

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Run an AI agent in structured-output (object) mode',
  methods: {
    POST: {
      operationId: 'aiAssistantRunObject',
      summary: 'Run an object-mode AI agent and return the generated object',
      description:
        'Invokes `runAiAgentObject` server-side for the registered AI agent identified by `agent` ' +
        '(matching "<module>.<agent>"). Enforces the same `requiredFeatures`, tool whitelisting, ' +
        'mutationPolicy, and attachment media-type policy as the chat dispatcher, but additionally ' +
        'requires the agent to declare `executionMode: "object"`. Returns the generated object in ' +
        'a single JSON response (no streaming). Agents owned by a registered agent run dispatcher ' +
        '(for example agent orchestrator agents) are delegated to it: the response then carries ' +
        '`runId: null` and the dispatcher run id in `agentRunId`.',
      requestBody: {
        contentType: 'application/json',
        description:
          'Object-mode dispatch payload. `agent` and `messages` are required; `attachmentIds`, `pageContext`, `modelOverride`, and `callSettings` are optional. Unknown `callSettings` keys (including `providerOptions`) and values outside the documented caps (temperature 0–2, topP 0–1, topK 1–1000, maxOutputTokens 1–32768, at most 4 stopSequences of up to 64 characters, penalties -2–2) are rejected with 400.',
        schema: runObjectRequestSchema,
      },
      responses: [
        {
          status: 200,
          description:
            'Object-mode run completed; response body contains `{ runId, object, usage?, finishReason? }`, plus `agentRunId` (with `runId: null`) when a dispatcher ran the agent.',
          mediaType: 'application/json',
          schema: runObjectResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Malformed payload or message cap exceeded.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks agent-level or tool-level required features.' },
        { status: 404, description: 'Unknown agent id.' },
        { status: 409, description: 'Agent/tool/execution-mode policy violation, or no principal to run a dispatched agent as.' },
        { status: 422, description: 'Agent does not support object-mode execution.' },
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
    case 'execution_mode_not_supported':
      return 422
    case 'tool_not_whitelisted':
    case 'tool_unknown':
    case 'mutation_blocked_by_readonly':
    case 'mutation_blocked_by_policy':
      return 409
    case 'attachment_type_not_accepted':
      return 400
    default:
      return 409
  }
}

type RunObjectAuth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

type RunObjectMessage = z.infer<typeof chatMessageSchema>

function buildDispatchInput(messages: RunObjectMessage[]): unknown {
  if (messages.length === 1 && messages[0].role === 'user') return messages[0].content
  return messages
}

function buildDispatchCaller(
  auth: RunObjectAuth,
  acl: { features: string[]; isSuperAdmin: boolean },
): AiAgentRunDispatchCaller | null {
  if (!auth.tenantId || !auth.orgId) return null
  const apiKeyId = auth.isApiKey ? (auth.keyId ?? null) : null
  const userId = auth.isApiKey ? (auth.userId ?? null) : auth.sub
  if (!apiKeyId && !userId) return null
  return {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId,
    apiKeyId,
    features: acl.features,
    isSuperAdmin: acl.isSuperAdmin,
  }
}

function principalMissingResponse(): NextResponse {
  return jsonError(409, 'No principal is available to run this agent.', 'agent_principal_missing')
}

async function dispatchRunObject(params: {
  dispatcher: AiAgentRunDispatcher
  agentId: string
  body: AiRunObjectRequest
  auth: RunObjectAuth
  acl: { features: string[]; isSuperAdmin: boolean }
  knownLocally: boolean
  correlationId: string
}): Promise<NextResponse> {
  const { dispatcher, agentId, body, auth, acl, knownLocally, correlationId } = params
  if (knownLocally) {
    const decision = checkAgentPolicy({
      agentId,
      authContext: { userFeatures: acl.features, isSuperAdmin: acl.isSuperAdmin },
      requestedExecutionMode: 'object',
      attachmentMediaTypes: undefined,
    })
    if (!decision.ok) {
      return jsonError(statusForDenyCode(decision.code), decision.message, decision.code)
    }
  }
  if (!(await dispatcher.isAvailable(agentId))) {
    return jsonError(404, `Agent "${agentId}" is not registered.`, 'agent_unknown')
  }
  const caller = buildDispatchCaller(auth, acl)
  if (!caller) return principalMissingResponse()
  try {
    const dispatched = await dispatcher.runObject({
      agentId,
      input: buildDispatchInput(body.messages),
      caller,
      channel: 'run-object',
      via: 'route',
      correlationId,
      ...(body.callSettings ? { callSettings: body.callSettings } : {}),
      timeoutMs: DISPATCH_TIMEOUT_MS,
    })
    return NextResponse.json({
      runId: null,
      agentRunId: dispatched.agentRunId,
      object: dispatched.result,
      finishReason: dispatched.finishReason ?? undefined,
      usage: dispatched.usage,
    })
  } catch (error) {
    if (isAiAgentDispatchDeniedError(error)) {
      if (error.code === 'agent_principal_missing') return principalMissingResponse()
      return jsonError(403, 'Access to this agent is denied.', 'agent_features_denied')
    }
    throw error
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'validation_error')
  }

  const bodyResult = runObjectRequestSchema.safeParse(parsedBody)
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

    const agentId = bodyResult.data.agent
    const correlationId = resolveCorrelationId(req.headers.get(CORRELATION_ID_HEADER))
    const dispatcher = resolveAiAgentRunDispatcher(container)
    const knownLocally = Boolean(getAgent(agentId))
    if (dispatcher && (await resolveDispatchOwner(dispatcher, agentId, { knownLocally }))) {
      return await dispatchRunObject({
        dispatcher,
        agentId,
        body: bodyResult.data,
        auth,
        acl,
        knownLocally,
        correlationId,
      })
    }

    const decision = checkAgentPolicy({
      agentId: bodyResult.data.agent,
      authContext: {
        userFeatures: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
      },
      requestedExecutionMode: 'object',
      attachmentMediaTypes: undefined,
    })

    if (!decision.ok) {
      return jsonError(statusForDenyCode(decision.code), decision.message, decision.code)
    }

    const result = await runAiAgentObject({
      agentId: bodyResult.data.agent,
      input: bodyResult.data.messages as unknown as UIMessage[],
      attachmentIds: bodyResult.data.attachmentIds,
      pageContext: bodyResult.data.pageContext,
      modelOverride: bodyResult.data.modelOverride,
      callSettings: bodyResult.data.callSettings,
      trace: {
        channel: 'run-object',
        correlationId,
      },
      authContext: {
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        features: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
      },
      container,
    })

    if (result.mode !== 'generate') {
      return jsonError(
        422,
        'Streaming object-mode is not supported by the run-object HTTP route; agent must use generate mode.',
        'execution_mode_not_supported',
      )
    }

    return NextResponse.json({
      runId: result.runId,
      object: result.object,
      finishReason: result.finishReason,
      usage: result.usage,
    })
  } catch (error) {
    if (error instanceof AgentPolicyError) {
      return jsonError(statusForDenyCode(error.code), error.message, error.code)
    }
    logger.error('AI Run Object — Dispatch failure', { err: error })
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Agent object dispatch failed.',
      'internal_error',
    )
  }
}
