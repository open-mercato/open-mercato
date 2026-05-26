import { NextResponse, type NextRequest } from 'next/server'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { loadAgentRegistry } from '../../../lib/agent-registry'
import { checkAgentPolicy, type AgentPolicyDenyCode } from '../../../lib/agent-policy'
import { runAiAgentObject } from '../../../lib/agent-runtime'
import { AgentPolicyError } from '../../../lib/agent-tools'

const MAX_MESSAGES = 100

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
        'a single JSON response (no streaming).',
      requestBody: {
        contentType: 'application/json',
        description:
          'Object-mode dispatch payload. `agent` and `messages` are required; `attachmentIds`, `pageContext`, and `modelOverride` are optional.',
        schema: runObjectRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Object-mode run completed; response body contains `{ object, usage?, finishReason? }`.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Malformed payload or message cap exceeded.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks agent-level or tool-level required features.' },
        { status: 404, description: 'Unknown agent id.' },
        { status: 409, description: 'Agent/tool/execution-mode policy violation.' },
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
      object: result.object,
      finishReason: result.finishReason,
      usage: result.usage,
    })
  } catch (error) {
    if (error instanceof AgentPolicyError) {
      return jsonError(statusForDenyCode(error.code), error.message, error.code)
    }
    console.error('[AI Run Object] Dispatch failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Agent object dispatch failed.',
      'internal_error',
    )
  }
}
