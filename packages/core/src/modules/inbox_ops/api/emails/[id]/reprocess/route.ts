import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxDiscrepancy, InboxEmail, InboxProposal, InboxProposalAction } from '../../../../data/entities'
import { emitInboxOpsEvent } from '../../../../events'
import {
  resolveRequestContext,
  extractPathSegment,
  UnauthorizedError,
} from '../../../routeHelpers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  reenqueueInboundAttachmentIngest,
  reportInboundAttachmentError,
  type InboundAttachmentEmailRef,
} from '../../../../lib/inboundAttachments'
import {
  clearInboundAttachmentFirstFailure,
  isLiveInboxEmail,
  planInboundAttachmentReprocess,
  resetFinalizedInboundAttachmentIngest,
} from '../../../../lib/inboundAttachmentReprocess'

const logger = createLogger('inbox_ops').child({ component: 'email-reprocess' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

class ReprocessConflictError extends Error {}

class AttachmentIngestResetMissedError extends Error {}

type Translate = Awaited<ReturnType<typeof resolveTranslations>>['translate']

function notFound(translate: Translate): NextResponse {
  return NextResponse.json({ error: translate('inbox_ops.errors.emailNotFound', 'Email not found') }, { status: 404 })
}

/**
 * Re-enqueues the ingest after the route's own writes; answers like the route: 409 when the email
 * completed or was deleted concurrently, 500 when the enqueue failed (the email is then stranded and
 * recovered by the catch-up, a further retry or the sweep).
 */
async function reenqueueIngestForRetry(
  em: EntityManager,
  ref: InboundAttachmentEmailRef,
  translate: Translate,
  body: { ok: true; retiredProposalCount: number; retiredActionCount: number },
): Promise<NextResponse> {
  const requeued = await reenqueueInboundAttachmentIngest({ em, email: ref })
  if (requeued.kind === 'not_reserved') {
    return NextResponse.json({
      error: translate('inbox_ops.errors.attachmentIngestNotRetryable', 'The attachments of this email can no longer be retried.'),
    }, { status: 409 })
  }
  if (requeued.kind === 'enqueue_failed') {
    logger.error('Failed to re-enqueue an inbound attachment ingest on manual retry', { emailId: ref.id })
    reportInboundAttachmentError(requeued.error, 'inbox_ops.attachment_requeue_failed', {
      emailId: ref.id,
      tenantId: ref.tenantId,
      step: 'reprocess',
    })
    return NextResponse.json({
      error: translate('inbox_ops.errors.attachmentIngestEnqueueFailed', 'Could not queue the attachments of this email. Try again.'),
    }, { status: 500 })
  }
  return NextResponse.json(body)
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()

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
      return notFound(translate)
    }

    const ref = { id: email.id, tenantId: email.tenantId, organizationId: email.organizationId }
    const attachmentPlan = await planInboundAttachmentReprocess(ctx.em, email)

    if (attachmentPlan === 'live_lease') {
      return NextResponse.json({
        error: translate('inbox_ops.errors.attachmentIngestInProgress', 'The attachments of this email are being processed. Try again later.'),
      }, { status: 409 })
    }

    if (attachmentPlan === 'requeue_ingest') {
      if (!(await clearInboundAttachmentFirstFailure(ctx.em, ref))) {
        return notFound(translate)
      }
      return reenqueueIngestForRetry(ctx.em, ref, translate, { ok: true, retiredProposalCount: 0, retiredActionCount: 0 })
    }

    if (email.status === 'received' || email.status === 'processing') {
      return NextResponse.json({
        error: translate('inbox_ops.errors.alreadyQueued', 'Email is already queued for processing'),
      }, { status: 409 })
    }

    let retiredCounts = { retiredProposalCount: 0, retiredActionCount: 0 }

    if (attachmentPlan === 'retry_failed_parts') {
      try {
        await withAtomicFlush(ctx.em, [
          async () => {
            if (!(await resetFinalizedInboundAttachmentIngest(ctx.em, ref, new Date()))) {
              throw new AttachmentIngestResetMissedError()
            }
          },
          async () => {
            retiredCounts = await retireActiveProposalsForEmail(ctx.em, email.id, ctx.userId, ctx.scope)
          },
        ], { transaction: true, label: 'inbox_ops.email.reprocessAttachments' })
      } catch (resetError) {
        if (!(resetError instanceof AttachmentIngestResetMissedError)) throw resetError
        if (!(await isLiveInboxEmail(ctx.em, ref))) return notFound(translate)
        return NextResponse.json({
          error: translate('inbox_ops.errors.reprocessAlreadyRequested', 'This email was already reset for reprocessing.'),
        }, { status: 409 })
      }

      try {
        await emitInboxOpsEvent('inbox_ops.email.reprocessed', {
          emailId: email.id,
          tenantId: email.tenantId,
          organizationId: email.organizationId,
        })
      } catch (eventError) {
        logger.error('Failed to emit events', { err: eventError })
      }

      return reenqueueIngestForRetry(ctx.em, ref, translate, { ok: true, ...retiredCounts })
    }

    await withAtomicFlush(ctx.em, [
      async () => {
        retiredCounts = await retireActiveProposalsForEmail(ctx.em, email.id, ctx.userId, ctx.scope)
      },
      () => {
        email.status = 'received'
        email.processingError = null
      },
    ], { transaction: true })

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
      }, {
        persistent: true,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
      })
    } catch (eventError) {
      logger.error('Failed to emit events', { err: eventError })
    }

    return NextResponse.json({ ok: true, ...retiredCounts })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (err instanceof ReprocessConflictError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json({
        error: translate('inbox_ops.errors.actionsAlreadyExecuted', err.message),
      }, { status: 409 })
    }

    logger.error('Reprocess failed', { err })
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

  // Resolve every read before mutating: a query issued between a scalar
  // mutation and the flush can silently reset the Unit of Work (SPEC-018
  // Problem 1). withAtomicFlush flushes once at the end, so ordering is ours.
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

  for (const discrepancy of discrepancies) {
    discrepancy.resolved = true
  }

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
      description: 'For an email whose attachments are pending, or processing with an expired lease, re-enqueues the attachment ingest without retiring proposals or emitting events. For an email whose attachment ingest finished with parts failed for an operator-fixable reason (ingest_timeout, quota_exceeded, partition_unavailable), resets those parts and lets the ingest worker emit inbox_ops.email.received once they are processed.',
      responses: [
        { status: 200, description: 'Email queued for reprocessing' },
        { status: 404, description: 'Email not found' },
        { status: 409, description: 'Email is already processing, its attachments are being processed, or proposal cannot be superseded safely' },
        { status: 500, description: 'The attachment ingest could not be queued' },
      ],
    },
  },
}
