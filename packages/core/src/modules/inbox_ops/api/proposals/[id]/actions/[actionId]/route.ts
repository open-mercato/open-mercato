import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runWithCacheTenant } from '@open-mercato/cache'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { actionEditSchema, validateActionPayloadForType } from '../../../../../data/validators'
import { emitInboxOpsEvent } from '../../../../../events'
import { resolveCache, invalidateCountsCache } from '../../../../../lib/cache'
import {
  resolveRequestContext,
  resolveActionAndProposal,
  handleRouteError,
  isErrorResponse,
} from '../../../../routeHelpers'

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

    action.payload = mergedPayload
    await ctx.em.flush()

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
      console.error('[inbox_ops:action:edit] Failed to emit event:', eventError)
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
