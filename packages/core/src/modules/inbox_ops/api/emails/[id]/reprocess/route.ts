import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxDiscrepancy, InboxEmail, InboxProposal, InboxProposalAction } from '../../../../data/entities'
import { resolveOptionalEventBus } from '../../../../lib/eventBus'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

class ReprocessConflictError extends Error {}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const segments = url.pathname.split('/')
    const id = segments[segments.indexOf('emails') + 1]

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as {
      userId?: string | null
      sub?: string | null
      tenantId?: string | null
      organizationId?: string | null
    }
    const userId = typeof auth.userId === 'string' ? auth.userId : typeof auth.sub === 'string' ? auth.sub : null
    if (!userId || !auth.tenantId || !auth.organizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = await em.findOne(InboxEmail, {
      id,
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    if (!email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }

    if (email.status === 'received' || email.status === 'processing') {
      return NextResponse.json({ error: 'Email is already queued for processing' }, { status: 409 })
    }

    const retiredCounts = await retireActiveProposalsForEmail(em, email.id, userId)

    email.status = 'received'
    email.processingError = null
    await em.flush()

    const eventBus = resolveOptionalEventBus(container)
    if (eventBus) {
      await eventBus.emit('inbox_ops.email.reprocessed', {
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
      })
      await eventBus.emit('inbox_ops.email.received', {
        emailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        forwardedByAddress: email.forwardedByAddress,
        subject: email.subject,
      })
    }

    return NextResponse.json({ ok: true, ...retiredCounts })
  } catch (err) {
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
): Promise<{ retiredProposalCount: number; retiredActionCount: number }> {
  const proposals = await em.find(InboxProposal, {
    inboxEmailId: emailId,
    isActive: true,
    deletedAt: null,
  })

  if (proposals.length === 0) {
    return { retiredProposalCount: 0, retiredActionCount: 0 }
  }

  const proposalIds = proposals.map((proposal) => proposal.id)
  const actions = await em.find(InboxProposalAction, {
    proposalId: { $in: proposalIds },
    deletedAt: null,
  })

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

  const discrepancies = await em.find(InboxDiscrepancy, {
    proposalId: { $in: proposalIds },
    resolved: false,
    deletedAt: null,
  })
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
