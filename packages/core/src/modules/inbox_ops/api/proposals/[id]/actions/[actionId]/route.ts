import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runWithCacheTenant } from '@open-mercato/cache'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { actionEditSchema, validateActionPayloadForType } from '../../../../../data/validators'
import { emitInboxOpsEvent } from '../../../../../events'
import { resolveCache, invalidateCountsCache } from '../../../../../lib/cache'
import {
  resolveRequestContext,
  resolveActionAndProposal,
  handleRouteError,
  isErrorResponse,
} from '../../../../routeHelpers'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('inbox_ops').child({ component: 'action-edit' })

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const parsed = actionEditSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)
    const resolved = await resolveActionAndProposal(new URL(req.url), ctx)
    if (isErrorResponse(resolved)) return resolved

    const { action } = resolved

    if (action.status !== 'pending' && action.status !== 'failed') {
      return NextResponse.json({ error: 'Action already processed' }, { status: 409 })
    }

    // Optimistic lock: refuse a stale overwrite when two tabs edit the same action
    // payload. Strictly additive — a no-op without the expected-version header.
    try {
      enforceCommandOptimisticLock({
        resourceKind: 'inbox_ops.action',
        resourceId: action.id,
        current: action.updatedAt ?? null,
        request: req,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }

    const mergedPayload = { ...action.payload as Record<string, unknown>, ...parsed.data.payload }
    const payloadValidation = validateActionPayloadForType(action.actionType, mergedPayload)
    if (!payloadValidation.success) {
      return NextResponse.json({ error: payloadValidation.error }, { status: 400 })
    }

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      resourceKind: 'inbox_ops:inbox_proposal_action',
      resourceId: action.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    action.payload = mergedPayload
    await ctx.em.flush()

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        resourceKind: 'inbox_ops:inbox_proposal_action',
        resourceId: action.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const cache = resolveCache(ctx.container)
    await runWithCacheTenant(ctx.tenantId, () => invalidateCountsCache(cache, ctx.tenantId))

    try {
      await emitInboxOpsEvent('inbox_ops.action.edited', {
        actionId: action.id,
        proposalId: action.proposalId,
        actionType: action.actionType,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
    } catch (eventError) {
      logger.error('Failed to emit event', { err: eventError })
    }

    return NextResponse.json({ ok: true, action })
  } catch (err) {
    return handleRouteError(err, 'edit action')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Edit action',
  methods: {
    PATCH: {
      summary: 'Edit action payload before accepting',
      responses: [
        { status: 200, description: 'Action updated' },
        { status: 404, description: 'Action not found' },
        { status: 409, description: 'Action already processed or stale (optimistic-lock conflict)' },
      ],
    },
  },
}
