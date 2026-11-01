import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CheckoutSession } from '../data/entities'
import { releaseCheckoutLinkSlot } from '../lib/payLinkCartSeed'
import { writeSessionEvent } from '../lib/sessionEvents'
import { emitCheckoutEvent } from '../events'

const logger = createLogger('checkout').child({ component: 'expire-checkout-sessions' })

export const CHECKOUT_EXPIRE_SESSIONS_QUEUE = 'checkout-expire-sessions'

export type ExpireCheckoutSessionsJob = {
  tenantId: string
  organizationId: string
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_EXPIRE_SESSIONS_QUEUE,
  id: 'checkout:expire-checkout-sessions',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }
type ExpiryScope = { tenantId: string; organizationId: string }

/**
 * PR 8268 review fix (Finding 5 follow-up, §12). This is the `expire-checkout-sessions`
 * job named but never shipped since Step 2.12 — `lib/session-status-machine.ts`'s own
 * `open -> expired` / `awaiting_approval -> expired` rows document it as reachable "from
 * code this Step ships" even though no caller ever drove either transition until now.
 *
 * `commands/session.ts`'s `{ source: 'link' }` branch claims a `reserveCheckoutLinkSlot`
 * slot (`lib/payLinkCartSeed.ts`) at session creation and only ever releases it on a
 * TERMINAL submit outcome (`commands/submit.ts`'s `compensateByCancellingOrder` /
 * `confirmOrderAndComplete` / `completeQuoteOutcome`). A buyer who never calls submit at
 * all — the common case, per the funnel's own "abandoned checkouts are the majority"
 * framing — leaves that slot claimed forever; against a `maxCompletions: 1` link, one
 * abandoned visit permanently kills it for every other buyer. This sweep CASes every
 * `open`/`awaiting_approval` session past its own `expiresAt` (§4.1's funnel TTL) to
 * `expired` and, for a `linkId`-originated one, releases the hold — the SAME permanent-
 * leak shape `transaction-expiry.worker.ts` already closes for the Phase A `pay_link`
 * transaction flow.
 */
export async function expireOneCheckoutSession(
  em: EntityManager,
  session: CheckoutSession,
  scope: ExpiryScope,
): Promise<void> {
  const affected = await em.nativeUpdate(
    CheckoutSession,
    { id: session.id, ...scope, status: session.status },
    { status: 'expired', updatedAt: new Date() },
  )
  // A concurrent writer (a live submit, a cancel, the "one live session per cart"
  // supersede) already moved this row out of the status this sweep observed — skipped,
  // never reported as an error, same CAS-race tolerance this module's other jobs apply.
  if (affected === 0) return

  if (session.linkId) {
    await releaseCheckoutLinkSlot(em, scope, session.linkId, { completed: false })
  }

  await writeSessionEvent(em, {
    ...scope,
    sessionId: session.id,
    kind: 'session_expired',
    actor: 'system',
    payload: { previousStatus: session.status },
  })
  await emitCheckoutEvent('checkout.session.expired', {
    sessionId: session.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    cartId: session.cartId ?? null,
  }).catch(() => undefined)
}

export default async function handle(job: QueuedJob<ExpireCheckoutSessionsJob>, ctx: HandlerContext): Promise<void> {
  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in ExpireCheckoutSessionsJob')
  }
  const { tenantId, organizationId } = job.payload
  const batchSize = job.payload.batchSize ?? 100
  const scope: ExpiryScope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const cutoff = new Date()

  const overdue = (await findWithDecryption(
    em,
    CheckoutSession,
    { tenantId, organizationId, status: { $in: ['open', 'awaiting_approval'] }, expiresAt: { $lt: cutoff } },
    { limit: batchSize, orderBy: { expiresAt: 'ASC' } },
    scope,
  )) as CheckoutSession[]

  for (const session of overdue) {
    try {
      await expireOneCheckoutSession(em, session, scope)
    } catch (err) {
      logger.error('[internal] expire-checkout-sessions: resolution failed for a session', { err, sessionId: session.id })
    }
  }
}
