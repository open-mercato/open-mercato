import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AiTokenUsageRepository } from '../../../../../data/repositories/AiTokenUsageRepository'
import { hasRequiredFeatures } from '../../../../../lib/auth'

const REQUIRED_FEATURE = 'ai_assistant.settings.manage'

const sessionIdParamSchema = z.object({
  sessionId: z
    .string()
    .trim()
    .uuid('sessionId must be a valid UUID'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Per-step token usage events for a session',
  methods: {
    GET: {
      operationId: 'aiAssistantUsageSessionDetail',
      summary: 'Fetch per-step token usage event rows for a single session.',
      description:
        'Returns up to 200 raw `ai_token_usage_events` rows for the given `sessionId`, ' +
        'ordered by `created_at ASC, step_index ASC`. Tenant-scoped. ' +
        'Requires `ai_assistant.settings.manage`.',
      responses: [
        {
          status: 200,
          description: 'Array of per-step event rows for the session.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid session id (must be a UUID).' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.settings.manage`.' },
        { status: 404, description: 'No events found for the given session id in the caller\'s tenant.' },
        { status: 500, description: 'Internal failure.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

interface RouteContext {
  params: Promise<{ sessionId: string }>
}

function jsonError(status: number, message: string, code: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  const rawParams = await context.params
  const paramResult = sessionIdParamSchema.safeParse(rawParams)
  if (!paramResult.success) {
    return jsonError(400, 'Invalid session id.', 'validation_error', {
      issues: paramResult.error.issues,
    })
  }

  const { sessionId } = paramResult.data

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    if (!hasRequiredFeatures([REQUIRED_FEATURE], acl.features, acl.isSuperAdmin, rbacService)) {
      return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
    }

    if (!auth.tenantId) {
      return jsonError(404, `No events found for session "${sessionId}".`, 'session_not_found')
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiTokenUsageRepository(em)
    const events = await repo.listEventsForSession(auth.tenantId, sessionId)

    if (events.length === 0) {
      return jsonError(404, `No events found for session "${sessionId}".`, 'session_not_found')
    }

    const serialized = events.map((event) => ({
      id: event.id,
      tenantId: event.tenantId,
      organizationId: event.organizationId ?? null,
      userId: event.userId,
      agentId: event.agentId,
      moduleId: event.moduleId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      stepIndex: event.stepIndex,
      providerId: event.providerId,
      modelId: event.modelId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedInputTokens: event.cachedInputTokens ?? null,
      reasoningTokens: event.reasoningTokens ?? null,
      finishReason: event.finishReason ?? null,
      loopAbortReason: event.loopAbortReason ?? null,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    }))

    return NextResponse.json({ events: serialized, total: serialized.length, sessionId })
  } catch (error) {
    console.error('[AI Usage Session Detail] GET error:', error)
    return jsonError(500, 'Failed to fetch session event data.', 'internal_error')
  }
}
