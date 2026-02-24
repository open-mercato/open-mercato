import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposal, InboxProposalAction } from '../../../../../../data/entities'
import { recalculateProposalStatus } from '../../../../../../lib/executionEngine'
import { formatZodErrors } from '../../../../../../lib/validation'
import {
  resolveRequestContext,
  resolveActionAndProposal,
  handleRouteError,
  isErrorResponse,
} from '../../../../../routeHelpers'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

const completeBodySchema = z.object({
  createdEntityId: z.string().uuid(),
  createdEntityType: z.string().trim().min(1).max(100),
})

export async function PATCH(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const resolved = await resolveActionAndProposal(new URL(req.url), ctx)
    if (isErrorResponse(resolved)) return resolved

    const { action, proposal } = resolved

    if (action.status !== 'pending' && action.status !== 'failed') {
      return NextResponse.json(
        { error: 'Action already processed' },
        { status: 409 },
      )
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = completeBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: `Invalid body: ${formatZodErrors(parsed.error)}` }, { status: 400 })
    }

    const em = ctx.em.fork()
    const freshAction = await findOneWithDecryption(
      em,
      InboxProposalAction,
      { id: action.id, deletedAt: null },
      undefined,
      ctx.scope,
    )
    if (!freshAction) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    }

    freshAction.status = 'executed'
    freshAction.executedAt = new Date()
    freshAction.executedByUserId = ctx.userId
    freshAction.createdEntityId = parsed.data.createdEntityId
    freshAction.createdEntityType = parsed.data.createdEntityType
    freshAction.executionError = null
    await em.flush()

    await recalculateProposalStatus(em, proposal.id, ctx.scope)

    const freshProposal = await findOneWithDecryption(
      em,
      InboxProposal,
      { id: proposal.id, deletedAt: null },
      undefined,
      ctx.scope,
    )

    return NextResponse.json({
      ok: true,
      action: {
        id: freshAction.id,
        status: freshAction.status,
        createdEntityId: freshAction.createdEntityId,
        createdEntityType: freshAction.createdEntityType,
        executedAt: freshAction.executedAt,
      },
      proposal: freshProposal ? {
        id: freshProposal.id,
        status: freshProposal.status,
      } : null,
    })
  } catch (err) {
    return handleRouteError(err, 'complete action')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Complete action externally',
  methods: {
    PATCH: {
      summary: 'Mark an action as completed with an externally-created entity',
      description: 'Used when an action is fulfilled through the normal sales form instead of the execution engine. Updates the action status without running the execution engine.',
      responses: [
        { status: 200, description: 'Action marked as completed' },
        { status: 400, description: 'Invalid body' },
        { status: 404, description: 'Action not found' },
        { status: 409, description: 'Action already processed' },
      ],
    },
  },
}
