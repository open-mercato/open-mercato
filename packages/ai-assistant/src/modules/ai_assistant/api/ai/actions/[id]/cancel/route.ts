import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AiPendingActionRepository } from '../../../../../data/repositories/AiPendingActionRepository'
import { hasRequiredFeatures } from '../../../../../lib/auth'
import { serializePendingActionForClient } from '../../../../../lib/pending-action-client'
import { checkStatusAndExpiry } from '../../../../../lib/pending-action-recheck'
import { executePendingActionCancel } from '../../../../../lib/pending-action-cancel'

/**
 * POST `/api/ai/actions/:id/cancel` — mutation approval gate cancel
 * endpoint (spec §9.4, Step 5.9).
 *
 * Siblings the Step 5.8 confirm route: flips `pending → cancelled` and
 * emits `ai.action.cancelled`. The tool handler is NEVER invoked.
 *
 * The route re-uses only the `status + expiry + tenant-scope` guards
 * from `pending-action-recheck.ts` — the agent / tool / attachment /
 * record-version guards are confirm-only. A caller may cancel even when
 * they'd be blocked from confirming; cancelling does not touch data.
 *
 * Idempotency: calling this endpoint twice on an already-`cancelled`
 * row returns 200 with the current row without re-emitting the event.
 */

const REQUIRED_FEATURE = 'ai_assistant.view'

const idParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'id must be a non-empty string')
    .max(128, 'id exceeds the maximum length of 128 characters'),
})

const bodySchema = z
  .object({
    reason: z
      .string()
      .max(500, 'reason must be at most 500 characters')
      .optional(),
  })
  .strict()
  .optional()

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Pending action (mutation approval gate) cancel',
  methods: {
    POST: {
      operationId: 'aiAssistantCancelPendingAction',
      summary: 'Cancel an AI pending action without executing the wrapped tool.',
      description:
        'Flips a pending AI action from `pending` to `cancelled` and emits the ' +
        '`ai.action.cancelled` event. The tool handler is never invoked. Idempotent: ' +
        'a second call on a row already in `cancelled` status returns 200 with the ' +
        'current row without re-emitting the event. Rows whose `expiresAt` is in the ' +
        'past are flipped to `expired` and returned as 409 `expired` so the client can ' +
        'surface the TTL loss instead of silently masking it as a cancellation.',
      responses: [
        {
          status: 200,
          description: 'Cancellation complete (or idempotent replay); body includes the serialized pending action with status `cancelled`.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid cancel request body (unknown field, reason exceeds 500 chars, wrong type).' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.view`.' },
        { status: 404, description: 'Pending action not found in the caller scope.' },
        { status: 409, description: 'Pending action is not in `pending` status (already confirmed/failed/executing) or has expired.' },
        { status: 500, description: 'Unexpected server failure during cancel.' },
      ],
    },
  },
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
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

async function readRequestBody(req: NextRequest): Promise<unknown> {
  try {
    const text = await req.text()
    if (!text || text.trim().length === 0) return undefined
    return JSON.parse(text)
  } catch {
    return Symbol.for('ai_assistant.cancel.bad_json')
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
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

  const rawBody = await readRequestBody(req)
  if (rawBody === Symbol.for('ai_assistant.cancel.bad_json')) {
    return jsonError(400, 'Invalid JSON body.', 'validation_error')
  }
  const bodyResult = bodySchema.safeParse(rawBody)
  if (!bodyResult.success) {
    return jsonError(400, 'Invalid cancel body.', 'validation_error', {
      issues: bodyResult.error.issues,
    })
  }
  const parsedBody = bodyResult.data ?? {}

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

    // Idempotent replay: second cancel on an already-cancelled row returns
    // 200 with the current row and does NOT emit a second event.
    if (row.status === 'cancelled') {
      return NextResponse.json({
        ok: true,
        pendingAction: serializePendingActionForClient(row),
      })
    }

    const statusCheck = checkStatusAndExpiry(row)
    if (!statusCheck.ok) {
      // Expired short-circuit: flip to `expired` + emit `ai.action.expired`
      // so Step 5.12 does not race to do it. Return 409 so the client
      // surfaces the TTL loss rather than silently cancelling.
      if (statusCheck.code === 'expired') {
        const cancelResult = await executePendingActionCancel({
          action: row,
          ctx: {
            tenantId: auth.tenantId,
            organizationId: auth.orgId ?? null,
            userId: auth.sub,
            container,
          },
          repo,
        })
        return jsonError(409, statusCheck.message, 'expired', {
          pendingAction: serializePendingActionForClient(cancelResult.row),
        })
      }
      return jsonError(statusCheck.status, statusCheck.message, statusCheck.code, statusCheck.extra)
    }

    const cancelResult = await executePendingActionCancel({
      action: row,
      ctx: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        container,
      },
      reason: parsedBody.reason,
      repo,
    })

    if (cancelResult.status === 'expired') {
      return jsonError(
        409,
        'Pending action has expired. The model must re-propose the mutation.',
        'expired',
        { pendingAction: serializePendingActionForClient(cancelResult.row) },
      )
    }

    return NextResponse.json({
      ok: true,
      pendingAction: serializePendingActionForClient(cancelResult.row),
    })
  } catch (error) {
    console.error('[AI Pending Action CANCEL] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to cancel pending action.',
      'cancel_internal_error',
    )
  }
}
