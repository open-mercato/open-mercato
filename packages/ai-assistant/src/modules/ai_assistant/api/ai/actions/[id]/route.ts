import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AiPendingActionRepository } from '../../../../data/repositories/AiPendingActionRepository'
import { hasRequiredFeatures } from '../../../../lib/auth'
import { serializePendingActionForClient } from '../../../../lib/pending-action-client'

/**
 * GET `/api/ai/actions/:id` — reconnect/polling endpoint for the Phase 3 WS-C
 * mutation approval gate (spec §9, Step 5.7).
 *
 * When the chat UI bounces (reload, tab switch, SSE reconnect) it carries a
 * `pendingActionId` from an earlier `mutation-preview-card` UI part and needs
 * to re-hydrate the pending row's current state. This route is the authoritative
 * read-side; the confirm/cancel routes (Steps 5.8 / 5.9) use the same
 * whitelist serializer so the UI always sees the same shape.
 */

const REQUIRED_FEATURE = 'ai_assistant.view'

const idParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'id must be a non-empty string')
    .max(128, 'id exceeds the maximum length of 128 characters'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Pending action (mutation approval gate) read-side',
  methods: {
    GET: {
      operationId: 'aiAssistantGetPendingAction',
      summary: 'Fetch the current state of an AI pending action by id.',
      description:
        'Returns the tenant-scoped {@link AiPendingAction} addressed by `:id`. Powers the ' +
        'chat UI reconnect/polling path: after a page reload or SSE reconnect the client ' +
        'carries the `pendingActionId` from an earlier `mutation-preview-card` UI part and ' +
        'calls this route to re-hydrate the card. Server-internal fields (`normalizedInput`, ' +
        '`createdByUserId`, `idempotencyKey`) are stripped by a whitelist serializer. ' +
        'Enforces tenant/org scoping via the repository.',
      responses: [
        {
          status: 200,
          description:
            'Serialized pending action. Never includes normalizedInput, createdByUserId, or idempotencyKey.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks the `ai_assistant.view` feature.' },
        { status: 404, description: 'No pending action with the given id is accessible to the caller.' },
        { status: 500, description: 'Internal runtime failure.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  const rawParams = await context.params
  const paramResult = idParamSchema.safeParse(rawParams)
  if (!paramResult.success) {
    return jsonError(400, 'Invalid pending action id.', 'validation_error', {
      issues: paramResult.error.issues,
    })
  }
  const pendingActionId = paramResult.data.id

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
      return jsonError(
        404,
        `No pending action "${pendingActionId}" accessible to the caller.`,
        'pending_action_not_found',
      )
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiPendingActionRepository(em)
    const row = await repo.getById(pendingActionId, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
    })

    if (!row) {
      return jsonError(
        404,
        `No pending action "${pendingActionId}" accessible to the caller.`,
        'pending_action_not_found',
      )
    }

    return NextResponse.json(serializePendingActionForClient(row))
  } catch (error) {
    console.error('[AI Pending Action GET] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to load pending action.',
      'internal_error',
    )
  }
}
