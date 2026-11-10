import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'
import { recordGatewayPayment } from '../commands/submit'

const logger = createLogger('checkout').child({ component: 'repair-gateway-payments' })

export const CHECKOUT_REPAIR_GATEWAY_PAYMENTS_QUEUE = 'checkout-repair-gateway-payments'

export type RepairGatewayPaymentsJob = {
  tenantId: string
  organizationId: string
  batchSize?: number
}

export const metadata: WorkerMeta = {
  queue: CHECKOUT_REPAIR_GATEWAY_PAYMENTS_QUEUE,
  id: 'checkout:repair-gateway-payments',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }
type RepairScope = { tenantId: string; organizationId: string }

// A transaction's `completed` status never changes again, so without a bound this sweep
// would re-scan every historical completed transaction forever. `recordGatewayPayment`'s
// own 3 immediate in-process retries cover almost every case; this worker exists only for
// the rare leftover, so a generous-but-finite lookback catches it without unbounded growth.
const REPAIR_LOOKBACK_MS = 48 * 60 * 60 * 1000

// #8268 review Major 6 (re-review): the previous fix bounded the batch this worker ACTS
// on (`batchSize`), but still loaded the ENTIRE lookback window with one unbounded
// `em.find` and built one `IN (orderIds...)` lookup from all of it before slicing — on a
// busy store that query, its memory footprint and its parameter count all grow with
// however many transactions completed in 48 hours, unbounded. Scanning now keyset-pages
// through the window in fixed-size slices instead, so both stay flat regardless of volume.
const REPAIR_PAGE_SIZE = 200
// Hard stop on a single job run's scan, independent of `batchSize`: caps this worker's
// own cost (worst case `REPAIR_MAX_PAGES * REPAIR_PAGE_SIZE` rows/IN-lookup per run) when
// a large backlog of already-recorded (no-op) transactions would otherwise make it page
// through the whole window every single run looking for the few still-outstanding ones.
const REPAIR_MAX_PAGES = 25

type TransactionCursor = { updatedAt: Date; id: string }

/**
 * #8268 review Medium 7: `recordGatewayPayment` (`commands/submit.ts`) already retries 3
 * times in-process, but a session-backed gateway payment is recorded AFTER the checkout
 * session (and, on the synchronous path, the order confirmation) already committed —
 * exhausting those 3 attempts used to just log/report and permanently leave a paid order
 * with no `SalesPayment` row, since nothing ever retried it again.
 *
 * This durable sweep closes that gap: `CheckoutTransaction` is the already-persisted
 * source of truth for a session-backed gateway payment (amount, currency, the gateway's
 * own reference, and the captured/authorized status), so no new column or queue payload
 * is needed to make the repair durable. It re-derives the exact same `GatewayPaymentRecord`
 * the live submit path would have passed and calls `recordGatewayPayment` again — safe to
 * run any number of times, since that function's own `findRecordedGatewayPayment` check
 * makes it a no-op the instant a matching `SalesPayment` exists (and reconciles a capture
 * onto an existing authorized-only payment, Major 5's own fix).
 *
 * Scoped to session-backed transactions only (`sessionId` set) — Phase A's link-only
 * transactions go through `checkout.transaction.updateStatus`'s own, separate flow and are
 * left alone here, same scoping `gatewayPaymentSessionResume.ts` already uses.
 */
export async function repairOneGatewayPayment(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  transaction: CheckoutTransaction,
  scope: RepairScope,
): Promise<void> {
  if (!transaction.orderId || !transaction.sessionId) return
  const session = await em.findOne(CheckoutSession, { id: transaction.sessionId, ...scope })
  if (!session) return

  await recordGatewayPayment(container, em, session, scope, transaction.orderId, {
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    paymentReference: transaction.gatewayTransactionId ?? transaction.id,
    captured: transaction.paymentStatus !== 'authorized',
  })
}

async function fetchCandidatePage(
  em: EntityManager,
  scope: RepairScope,
  cutoff: Date,
  cursor: TransactionCursor | null,
): Promise<CheckoutTransaction[]> {
  const where: FilterQuery<CheckoutTransaction> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'completed',
    sessionId: { $ne: null },
    orderId: { $ne: null },
    updatedAt: { $gte: cutoff },
  }
  if (cursor) {
    // Keyset pagination tiebreaker: `updatedAt` alone can repeat across rows, `id` never
    // does, so `(updatedAt, id)` ascending is a stable total order to page through.
    ;(where as Record<string, unknown>).$or = [
      { updatedAt: { $gt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, id: { $gt: cursor.id } },
    ]
  }
  return em.find(CheckoutTransaction, where, {
    orderBy: { updatedAt: 'ASC', id: 'ASC' },
    limit: REPAIR_PAGE_SIZE,
  })
}

export default async function handle(job: QueuedJob<RepairGatewayPaymentsJob>, ctx: HandlerContext): Promise<void> {
  if (!job.payload?.tenantId || !job.payload?.organizationId) {
    throw new Error('[internal] tenantId and organizationId are required in RepairGatewayPaymentsJob')
  }
  const { tenantId, organizationId } = job.payload
  const batchSize = job.payload.batchSize ?? 50
  const scope: RepairScope = { tenantId, organizationId }
  const em = (ctx.resolve('em') as EntityManager).fork()
  const container = { resolve: ctx.resolve } as unknown as CommandRuntimeContext['container']
  const cutoff = new Date(Date.now() - REPAIR_LOOKBACK_MS)

  const outstanding: CheckoutTransaction[] = []
  let cursor: TransactionCursor | null = null
  let pagesScanned = 0

  while (outstanding.length < batchSize && pagesScanned < REPAIR_MAX_PAGES) {
    const page = await fetchCandidatePage(em, scope, cutoff, cursor)
    pagesScanned += 1
    if (page.length === 0) break
    const last = page[page.length - 1]
    cursor = { updatedAt: last.updatedAt, id: last.id }
    outstanding.push(...(await filterOutstandingGatewayPayments(em, scope, page)))
    if (page.length < REPAIR_PAGE_SIZE) break
  }

  // Observability for the recovery policy the bounded scan trades away: a sweep that
  // exhausts its page budget without clearing the backlog down to `batchSize` means more
  // outstanding work sits further back in the window than this run reached. Nothing here
  // is lost yet — the next run resumes from the same oldest-first ordering — but if the
  // backlog persists for close to `REPAIR_LOOKBACK_MS`, the oldest entries will leave the
  // `updatedAt >= cutoff` window unrepaired. This is this worker's only signal of that risk.
  if (pagesScanned >= REPAIR_MAX_PAGES) {
    logger.warn('[internal] repair-gateway-payments: scan hit its page cap before clearing the backlog — older outstanding transactions may be close to aging out of the lookback window', {
      tenantId,
      organizationId,
      pagesScanned,
      pageSize: REPAIR_PAGE_SIZE,
      lookbackMs: REPAIR_LOOKBACK_MS,
      outstandingFound: outstanding.length,
    })
  }

  if (outstanding.length === 0) return
  const batch = outstanding.slice(0, batchSize)

  for (const transaction of batch) {
    try {
      await repairOneGatewayPayment(container, em, transaction, scope)
    } catch (err) {
      logger.error('[internal] repair-gateway-payments: repair failed for a transaction', { err, transactionId: transaction.id })
    }
  }
}

// #8268 review Major 4: selecting the oldest `batchSize` candidates by `updatedAt`
// permanently starves this sweep once more than `batchSize` transactions accumulate in
// the lookback window — nothing here ever changes a transaction's `updatedAt`, so an
// already-repaired (or already-correct) row never leaves the oldest-N set, and a newer
// transaction that genuinely needs repair can never be selected. This re-derives the SAME
// "would `recordGatewayPayment` actually do anything?" check that function's own
// `findRecordedGatewayPayment` no-op branch uses, as a single batch lookup against
// `sales_payments`, and filters candidates down to only the ones still outstanding BEFORE
// slicing to `batchSize` — so a repaired transaction frees its slot for the sweep's next
// run instead of permanently occupying it.
async function filterOutstandingGatewayPayments(
  em: EntityManager,
  scope: RepairScope,
  candidates: CheckoutTransaction[],
): Promise<CheckoutTransaction[]> {
  const orderIds = [...new Set(candidates.map((transaction) => transaction.orderId as string))]
  const existing = await em
    .getKysely<{
      sales_payments: {
        tenant_id: string
        organization_id: string
        order_id: string
        payment_reference: string | null
        captured_amount: string
        deleted_at: Date | null
      }
    }>()
    .selectFrom('sales_payments')
    .select(['order_id', 'payment_reference', 'captured_amount'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .where('order_id', 'in', orderIds)
    .execute()
  const recordedByKey = new Map(existing.map((row) => [`${row.order_id}:${row.payment_reference ?? ''}`, row]))

  return candidates.filter((transaction) => {
    const paymentReference = transaction.gatewayTransactionId ?? transaction.id
    const recorded = recordedByKey.get(`${transaction.orderId}:${paymentReference}`)
    if (!recorded) return true
    const captured = transaction.paymentStatus !== 'authorized'
    return captured && Number(recorded.captured_amount) <= 0
  })
}
