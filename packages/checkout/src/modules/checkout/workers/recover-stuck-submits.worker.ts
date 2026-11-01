import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CartService } from '@open-mercato/core/modules/cart/lib/cartService'
import { CheckoutSession } from '../data/entities'
import { compensate, compensateByCancellingOrder, completeQuoteOutcome, continueOrderOutcome } from '../commands/submit'
import { writeSessionEvent } from '../lib/sessionEvents'
import { emitCheckoutEvent } from '../events'
import { tryResolve } from '../lib/tryResolve'

const logger = createLogger('checkout').child({ component: 'recover-stuck-submits' })

export const CHECKOUT_RECOVER_STUCK_SUBMITS_QUEUE = 'checkout-recover-stuck-submits'

// §12: "Sessions in `submitting` with `submit_started_at` older than 120 s."
const STUCK_THRESHOLD_MS = 120_000
// Scope reduction (documented in PLAN.md's "Decisions taken without the owner" / NOTIFY.md):
// this job handles ONLY the `submitting` half of §12's table (C24's own decision rows are
// all keyed by `submit_progress`, which only applies while `status = 'submitting'`).
// `awaiting_payment` recovery is §12's OWN separate job, `expire-awaiting-payment` — it
// reads live gateway status to decide paid-vs-expired, a materially different, larger
// surface this Step does not build.
const RECOVERY_GIVE_UP_MS = 30 * 60 * 1000

export type RecoverStuckSubmitsJob = {
  tenantId: string
  organizationId: string
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_RECOVER_STUCK_SUBMITS_QUEUE,
  id: 'checkout:recover-stuck-submits',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }
type RecoveryScope = { tenantId: string; organizationId: string }

async function safeUnlockCart(
  container: CommandRuntimeContext['container'],
  session: CheckoutSession,
  scope: RecoveryScope,
): Promise<void> {
  if (!session.cartId) return
  const cartService = tryResolve<CartService>(container, 'cartService')
  if (!cartService) return
  try {
    await cartService.unlock({ cartId: session.cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, checkoutSessionId: session.id })
  } catch (err) {
    // §12.1, `null` row: "Not locked -> status open" — a 404 here means this session
    // never actually held the lock (crashed before `cart.lock` returned), not a failure.
    if (err instanceof CrudHttpError && err.status === 404) return
    throw err
  }
}

/**
 * §12.1's recovery decision table (C24), reduced to the `submitting`-only half (see this
 * file's own header comment). Every probe/action below reuses the SAME idempotent
 * primitives the live submit path calls — `compensate` and `continueOrderOutcome`, both
 * exported by `commands/submit.ts` — never a parallel reimplementation.
 */
export async function recoverOneStuckSubmit(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  session: CheckoutSession,
  scope: RecoveryScope,
): Promise<void> {
  const progress = session.submitProgress

  // Release 5, Step 5.1 (§8.6, D-R5-20): a `request_quote` submit only ever reaches
  // `submit_progress = 'document_created'` (never `finalized` — steps 6-8 do not exist
  // for a quote outcome), and the live path completes it within the SAME call, well
  // before this job's `STUCK_THRESHOLD_MS` could ever observe it mid-flight. The only way
  // a session is found here with `paymentMethodCode === 'request_quote'` is a crash in
  // the narrow window between document creation and `completeQuoteOutcome` returning —
  // resumed through that EXACT function, never `continueOrderOutcome` (which would
  // wrongly try to confirm/commit/gateway an order that for a quote outcome never exists).
  if (progress === 'document_created' && session.paymentMethodCode === 'request_quote') {
    if (!session.salesQuoteId) {
      logger.error('[internal] recover-stuck-submits: quote-outcome session is missing salesQuoteId to resume forward', {
        sessionId: session.id,
        progress,
      })
      return
    }
    try {
      await completeQuoteOutcome(container, em, session, scope, session.salesQuoteId, {
        stockReservationKey: session.stockReservationKey ?? null,
      })
      await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'recovery', actor: 'system', payload: { action: 'resumed', fromProgress: progress } })
      return
    } catch (err) {
      const startedAt = session.submitStartedAt ? session.submitStartedAt.getTime() : 0
      if (Date.now() - startedAt < RECOVERY_GIVE_UP_MS) {
        logger.warn('[internal] recover-stuck-submits: quote resume attempt failed, will retry next tick', { err, sessionId: session.id, progress })
        return
      }
      logger.error('[internal] recover-stuck-submits: giving up on an old stuck quote attempt, compensating', { err, sessionId: session.id, progress })
      await safeUnlockCart(container, session, scope)
      await em.nativeUpdate(CheckoutSession, { id: session.id, ...scope }, { status: 'failed', failureCode: 'submit_recovery_failed', updatedAt: new Date() })
      await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'recovery', actor: 'system', payload: { action: 'gave_up', fromProgress: progress } })
      await emitCheckoutEvent('checkout.session.failed', { sessionId: session.id, tenantId: scope.tenantId, organizationId: scope.organizationId, cartId: session.cartId ?? null, attempt: session.submitAttempt, failureCode: 'submit_recovery_failed' }).catch(() => undefined)
      return
    }
  }

  if (progress === 'document_created' || progress === 'finalized') {
    // §12.1: "Quote present, not converted, order outcome -> resume forward from 5b
    // (idempotent)" / "Resume step 6 forward... each sub-step is idempotent under its
    // key" / "No intent -> resume step 7." `continueOrderOutcome` IS steps 6-8, so
    // calling it again with the session's own stored keys/ids safely no-ops whatever
    // already completed (availability.commit, the credit link, useCode/registerUsage,
    // the CheckoutTransaction lookup-before-create) and continues from the first
    // incomplete sub-step.
    if (!session.salesOrderId || !session.salesQuoteId || !session.paymentMethodCode) {
      logger.error('[internal] recover-stuck-submits: session is missing required fields to resume forward', {
        sessionId: session.id,
        progress,
      })
      return
    }
    try {
      await continueOrderOutcome(container, {
        session,
        scope,
        attempt: session.submitAttempt,
        paymentMethodCode: session.paymentMethodCode,
        stockReservationKey: session.stockReservationKey ?? null,
        creditReservationKey: session.creditReservationKey ?? null,
        quoteId: session.salesQuoteId,
        orderId: session.salesOrderId,
        request: null,
      })
      await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'recovery', actor: 'system', payload: { action: 'resumed', fromProgress: progress } })
      return
    } catch (err) {
      const startedAt = session.submitStartedAt ? session.submitStartedAt.getTime() : 0
      if (Date.now() - startedAt < RECOVERY_GIVE_UP_MS) {
        // Still within the give-up window — log and let the next tick retry; the
        // resume call is idempotent, so a transient failure costs nothing to re-attempt.
        logger.warn('[internal] recover-stuck-submits: resume attempt failed, will retry next tick', { err, sessionId: session.id, progress })
        return
      }
      // §12.1's own final row: "attempt older than the payment TTL without an intent ->
      // Compensate per §7.3 and fail with submit_recovery_failed." An order already
      // exists at this point (checked above), so compensation means CANCELLING it —
      // `compensateByCancellingOrder` is the same primitive the live submit path uses,
      // which also unlocks the cart and marks the session failed; everything else
      // (stock/credit/promotion release) follows from the order cancellation through the
      // existing `sales.order.cancelled` subscribers, never a parallel release here.
      logger.error('[internal] recover-stuck-submits: giving up on an old stuck attempt, compensating', { err, sessionId: session.id, progress })
      await compensateByCancellingOrder(container, em, session, scope, session.salesOrderId, 'submit_recovery_failed')
      await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'recovery', actor: 'system', payload: { action: 'gave_up', fromProgress: progress } })
      return
    }
  }

  // §12.1's `null` / `locked` / `stock_reserved` / `credit_reserved` rows, collapsed into
  // ONE uniform compensate-and-reopen (documented scope reduction, NOTIFY.md).
  //
  // Why collapsed: `commands/submit.ts`'s own steps 1-5 (Step 4.1) never persist
  // `submit_progress` as `locked`/`stock_reserved`/`credit_reserved` on the
  // `CheckoutSession` row itself — ONLY `null` (at the CAS) and `document_created` (step
  // 5d) are ever written; the matching `writeSessionEvent` calls at each of those three
  // intermediate steps append `CheckoutSessionEvent` AUDIT rows, not a `submit_progress`
  // column update. So a session crashed anywhere in steps 1-4 is observed here with
  // `submit_progress === null` regardless of how far it actually got — probing the cart's
  // lock holder alone (as this worker's FIRST version did) would then skip releasing a
  // stock/credit reservation that genuinely WAS taken, exactly the R3 leak §7.3 warns
  // against. The fix: ALWAYS attempt to release both, using the session's own stored
  // `stock_reservation_key`/`credit_reservation_key` (written once, at the CAS, before any
  // of steps 1-4 run) — `availability.release`/`releaseCredit` both already tolerate "there
  // was nothing to release" as a no-op, so this is safe whether or not a given key's step
  // ever actually ran. A quote created before the crash (progress still `null`, crash in
  // step 5) is left in place, never deleted, per §7.3 — the buyer's next submit attempt
  // mints a fresh `external_reference` and never touches it.
  await safeUnlockCart(container, session, scope)
  await compensate(
    container,
    em,
    session,
    scope,
    { releaseCredit: true, releaseStock: true, unlockCart: false },
    { stockReservationKey: session.stockReservationKey ?? null, creditReservationKey: session.creditReservationKey ?? null },
  )
  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'recovery', actor: 'system', payload: { action: 'reopened', fromProgress: progress } })
}

export default async function handle(job: QueuedJob<RecoverStuckSubmitsJob>, ctx: HandlerContext): Promise<void> {
  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in RecoverStuckSubmitsJob')
  }
  const { tenantId, organizationId } = job.payload
  const batchSize = job.payload.batchSize ?? 50
  const scope: RecoveryScope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS)
  const container = { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container']

  const stuck = (await findWithDecryption(
    em,
    CheckoutSession,
    { tenantId, organizationId, status: 'submitting', submitStartedAt: { $lt: cutoff } },
    { limit: batchSize, orderBy: { submitStartedAt: 'ASC' } },
    scope,
  )) as CheckoutSession[]

  for (const session of stuck) {
    try {
      await recoverOneStuckSubmit(container, em, session, scope)
    } catch (err) {
      logger.error('[internal] recover-stuck-submits: recovery failed for a session', { err, sessionId: session.id })
    }
  }
}
