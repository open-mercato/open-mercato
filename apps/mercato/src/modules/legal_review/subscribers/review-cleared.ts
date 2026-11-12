import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { countLatestReviewOpenBlocking } from '@open-mercato/documents/modules/documents/lib/findingSummary'
import { sendSignalByCorrelationKey } from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { DOCUMENTS_REVIEW_CLEARED_SIGNAL } from '../lib/constants'
import { buildNdaReviewCorrelationKey } from '../lib/ndaReviewWorkflow'
import { findOpenMattersForDocument, releaseLegalMatter } from '../lib/release'

export const metadata = {
  event: 'documents.review.cleared',
  persistent: true,
  id: 'legal_review:review-cleared',
}

const logger = createLogger('legal_review').child({ component: 'review-cleared' })

const reviewClearedPayloadSchema = z.object({
  documentId: z.string().uuid(),
  reviewId: z.string().min(1),
  decidedByUserId: z.string().uuid().nullish(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: AwilixContainer
}

/**
 * Consumer side of the Documents review signal.
 *
 * `documents.review.cleared` is a level-change notification, so the handler
 * first confirms the current state (the latest review still has zero open
 * blocking findings) and is idempotent. It then:
 *
 * 1. sends `documents_review_cleared` to NDA review runs parked on the
 *    clearance wait (correlation key `legal_review:<documentId>`) — the run
 *    releases the matter itself through `legal_review.matter.release`;
 * 2. when no run was waiting (no workflow in use, or the review cleared at
 *    ingest before the run reached the wait), releases the document's open
 *    matters directly.
 */
export default async function handleReviewCleared(payload: unknown, ctx: ResolverContext): Promise<void> {
  const parsed = reviewClearedPayloadSchema.safeParse(payload)
  if (!parsed.success) return
  const { documentId, reviewId, decidedByUserId, tenantId, organizationId } = parsed.data
  const scope = { tenantId, organizationId }
  const em = ctx.resolve<EntityManager>('em').fork()

  const openBlocking = await countLatestReviewOpenBlocking(em, scope, documentId, reviewId)
  if (openBlocking === null || openBlocking > 0) return

  const matters = await findOpenMattersForDocument(em, scope, documentId)
  if (matters.length === 0) return

  const container = ctx.container ?? (ctx as unknown as AwilixContainer)
  const signalled = await sendSignalByCorrelationKey(em, container, {
    correlationKey: buildNdaReviewCorrelationKey(documentId),
    signalName: DOCUMENTS_REVIEW_CLEARED_SIGNAL,
    payload: { documentId, reviewId },
    ...(decidedByUserId ? { userId: decidedByUserId } : {}),
    tenantId,
    organizationId,
  })
  if (signalled > 0) return

  for (const matter of matters) {
    const result = await releaseLegalMatter(em, scope, matter.id)
    if (result?.released) {
      logger.info('released legal matter after review cleared', { matterId: matter.id, documentId })
    }
  }
}
