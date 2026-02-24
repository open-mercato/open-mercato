import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxDiscrepancy, InboxEmail, InboxProposal, InboxProposalAction } from '../../../../data/entities'
import { emitInboxOpsEvent } from '../../../../events'
import {
  resolveRequestContext,
  extractPathSegment,
  UnauthorizedError,
} from '../../../routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

class ReprocessConflictError extends Error {}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)

    const email = await findOneWithDecryption(
      ctx.em,
      InboxEmail,
      {
        id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      undefined,
      ctx.scope,
    )

    if (!email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }

    if (email.status === 'received' || email.status === 'processing') {
      return NextResponse.json({ error: 'Email is already queued for processing' }, { status: 409 })
    }

    const retiredCounts = await retireActiveProposalsForEmail(ctx.em, email.id, ctx.userId, ctx.scope)

    email.status = 'received'
    email.processingError = null
    await ctx.em.flush()

    try {
      await emitInboxOpsEvent('inbox_ops.email.reprocessed', {
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
      })
      await emitInboxOpsEvent('inbox_ops.email.received', {
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        forwardedByAddress: email.forwardedByAddress,
        subject: email.subject,
      })
    } catch (eventError) {
      console.error('[inbox_ops:email:reprocess] Failed to emit events:', eventError)
    }

    return NextResponse.json({ ok: true, ...retiredCounts })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (err instanceof ReprocessConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }

    console.error('[inbox_ops:email:reprocess] Error:', err)
    return NextResponse.json({ error: 'Failed to reprocess email' }, { status: 500 })
  }
}

async function retireActiveProposalsForEmail(
  em: EntityManager,
  emailId: string,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<{ retiredProposalCount: number; retiredActionCount: number }> {
  const proposals = await findWithDecryption(
    em,
    InboxProposal,
    {
      inboxEmailId: emailId,
      isActive: true,
      deletedAt: null,
    },
    undefined,
    scope,
  )

  if (proposals.length === 0) {
    return { retiredProposalCount: 0, retiredActionCount: 0 }
  }

  const proposalIds = proposals.map((proposal) => proposal.id)
  const actions = await findWithDecryption(
    em,
    InboxProposalAction,
    {
      proposalId: { $in: proposalIds },
      deletedAt: null,
    },
    undefined,
    scope,
  )

  if (actions.some((action) => action.status === 'accepted' || action.status === 'executed' || action.status === 'processing')) {
    throw new ReprocessConflictError('Cannot reprocess after actions were already executed. Open the latest proposal instead.')
  }

  const now = new Date()
  const supersededAt = now.toISOString()
  for (const proposal of proposals) {
    const previousMetadata = proposal.metadata && typeof proposal.metadata === 'object'
      ? proposal.metadata
      : {}
    proposal.isActive = false
    proposal.status = proposal.status === 'accepted' ? proposal.status : 'rejected'
    proposal.reviewedAt = now
    proposal.reviewedByUserId = userId
    proposal.metadata = {
      ...previousMetadata,
      supersededAt,
      supersededByUserId: userId,
      supersededReason: 'email_reprocessed',
    }
  }

  let retiredActionCount = 0
  for (const action of actions) {
    if (action.status !== 'pending' && action.status !== 'failed') {
      continue
    }
    action.status = 'rejected'
    action.executedAt = now
    action.executedByUserId = userId
    action.executionError = action.executionError || 'Superseded by email reprocess'
    retiredActionCount += 1
  }

  const discrepancies = await findWithDecryption(
    em,
    InboxDiscrepancy,
    {
      proposalId: { $in: proposalIds },
      resolved: false,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  for (const discrepancy of discrepancies) {
    discrepancy.resolved = true
  }

  await em.flush()

  return {
    retiredProposalCount: proposals.length,
    retiredActionCount,
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Reprocess email',
  methods: {
    POST: {
      summary: 'Re-trigger LLM extraction on a failed or low-confidence email',
      responses: [
        { status: 200, description: 'Email queued for reprocessing' },
        { status: 404, description: 'Email not found' },
        { status: 409, description: 'Email is already processing or proposal cannot be superseded safely' },
      ],
    },
  },
}
