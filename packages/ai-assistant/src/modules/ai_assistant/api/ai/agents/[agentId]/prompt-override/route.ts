import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getAgent, loadAgentRegistry } from '../../../../../lib/agent-registry'
import { hasRequiredFeatures } from '../../../../../lib/auth'

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const agentIdParamSchema = z.object({
  agentId: z
    .string()
    .regex(agentIdPattern, 'agentId must match "<module>.<agent>" (lowercase, digits, underscores only)'),
})

const promptOverrideRequestSchema = z.object({
  overrides: z.record(z.string(), z.string()),
})

export type AiPromptOverrideRequest = z.infer<typeof promptOverrideRequestSchema>

const REQUIRED_FEATURE = 'ai_assistant.settings.manage'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Submit additive prompt-section overrides for an AI agent (placeholder)',
  methods: {
    POST: {
      operationId: 'aiAssistantSubmitPromptOverride',
      summary: 'Submit prompt-section overrides for the agent (placeholder; persistence lands in Phase 3 Step 5.3).',
      description:
        'Accepts an additive `{ overrides: Record<sectionId, text> }` body for the agent identified ' +
        'by the URL path. Validates the agent exists and enforces `ai_assistant.settings.manage`, but ' +
        'DOES NOT persist anything — it exists so the backend settings UI (Step 4.5) can exercise the ' +
        'full request path before Phase 3 Step 5.3 wires real versioned storage. Returns ' +
        '`{ pending: true, agentId, message }` on success.',
      requestBody: {
        contentType: 'application/json',
        description: 'Object mapping prompt-section ids (per spec §8) to override text.',
        schema: promptOverrideRequestSchema,
      },
      responses: [
        {
          status: 200,
          description:
            'Placeholder acknowledgement. `pending: true` signals persistence is not yet wired (Step 5.3).',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid agent id or malformed body.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.settings.manage`.' },
        { status: 404, description: 'Unknown agent id.' },
      ],
    },
  },
}

export const metadata = {
  requireAuth: true,
  requireFeatures: [REQUIRED_FEATURE],
}

interface RouteContext {
  params: Promise<{ agentId: string }>
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  const rawParams = await context.params
  const paramResult = agentIdParamSchema.safeParse(rawParams)
  if (!paramResult.success) {
    return jsonError(400, 'Invalid agent id.', 'validation_error', {
      issues: paramResult.error.issues,
    })
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'validation_error')
  }

  const bodyResult = promptOverrideRequestSchema.safeParse(parsedBody)
  if (!bodyResult.success) {
    return jsonError(400, 'Invalid request body.', 'validation_error', {
      issues: bodyResult.error.issues,
    })
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    if (!hasRequiredFeatures([REQUIRED_FEATURE], acl.features, acl.isSuperAdmin, rbacService)) {
      return jsonError(
        403,
        `Caller lacks required feature "${REQUIRED_FEATURE}".`,
        'forbidden',
      )
    }

    await loadAgentRegistry()
    const agent = getAgent(paramResult.data.agentId)
    if (!agent) {
      return jsonError(
        404,
        `Unknown agent "${paramResult.data.agentId}".`,
        'agent_unknown',
      )
    }

    return NextResponse.json({
      pending: true,
      agentId: agent.id,
      message: 'Persistence lands in Phase 3 Step 5.3.',
    })
  } catch (error) {
    console.error('[AI Prompt Override] Placeholder failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to accept prompt override.',
      'internal_error',
    )
  }
}
