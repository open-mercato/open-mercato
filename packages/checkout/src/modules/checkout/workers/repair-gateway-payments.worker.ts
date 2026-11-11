import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'
import { recordGatewayPayment } from '../commands/submit'
import { tryResolve } from '../lib/tryResolve'

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
//
// That lookback is ONLY a cheap default scanning window, not this worker's sole recovery
// path: a transaction can still be outstanding when its `updatedAt` crosses the cutoff
// (e.g. during a multi-day outage of whatever this worker depends on), and the small
// "ancient" safety-net scan below (`REPAIR_ANCIENT_PAGE_SIZE`) exists specifically so that
// still-broken work older than the window is never permanently unreachable.
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

// #8268 review: bounded repair still starves and expires unresolved payments. Scanning
// always started from `cursor = null` (the oldest row in the window) on every single run,
// so once more than `REPAIR_MAX_PAGES * REPAIR_PAGE_SIZE` already-correct rows accumulate
// in the window, the sweep re-discards that SAME dead zone forever and can never reach
// anything past it. The cursor is now persisted across runs (see `loadCursorState` /
// `persistCursorState`) so each run resumes roughly where the previous one stopped,
// wrapping back to `null` only once a run's page comes back short of `REPAIR_PAGE_SIZE`
// (i.e. the scan actually caught up to "now" within the window) — so the sweep still
// eventually revisits the whole window without re-scanning the same prefix every time.
const REPAIR_CURSOR_CONFIG_MODULE_ID = 'checkout'
const repairCursorConfigName = (organizationId: string) => `repair-gateway-payments:cursor:${organizationId}`

// The ancient safety-net scan's own page size — deliberately tiny and fixed, independent
// of how large the ancient (pre-cutoff) backlog grows during an outage. It keyset-pages
// through `updatedAt < cutoff` the same way the main scan pages through `updatedAt >=
// cutoff`, using its OWN persisted cursor, so a bad outage that ages many transactions out
// of the lookback window gets worked through a little at a time across many runs instead
// of either being scanned in full (reintroducing unbounded growth) or never revisited.
const REPAIR_ANCIENT_PAGE_SIZE = 20

type TransactionCursor = { updatedAt: Date; id: string }
type ScanMode = 'window' | 'ancient'

type RepairCursorState = {
  mainCursor: TransactionCursor | null
  ancientCursor: TransactionCursor | null
}

const NULL_CURSOR_STATE: RepairCursorState = { mainCursor: null, ancientCursor: null }

function serializeCursor(cursor: TransactionCursor | null): { updatedAt: string; id: string } | null {
  return cursor ? { updatedAt: cursor.updatedAt.toISOString(), id: cursor.id } : null
}

function deserializeCursor(raw: unknown): TransactionCursor | null {
  if (!raw || typeof raw !== 'object') return null
  const updatedAtRaw = (raw as Record<string, unknown>).updatedAt
  const idRaw = (raw as Record<string, unknown>).id
  if (typeof updatedAtRaw !== 'string' || typeof idRaw !== 'string') return null
  const updatedAt = new Date(updatedAtRaw)
  if (Number.isNaN(updatedAt.getTime())) return null
  return { updatedAt, id: idRaw }
}

async function loadCursorState(
  moduleConfigService: ModuleConfigService | undefined,
  scope: RepairScope,
): Promise<RepairCursorState> {
  if (!moduleConfigService) return NULL_CURSOR_STATE
  try {
    const raw = await moduleConfigService.getValue<Record<string, unknown>>(
      REPAIR_CURSOR_CONFIG_MODULE_ID,
      repairCursorConfigName(scope.organizationId),
      { scope: { tenantId: scope.tenantId } },
    )
    if (!raw || typeof raw !== 'object') return NULL_CURSOR_STATE
    return {
      mainCursor: deserializeCursor((raw as Record<string, unknown>).mainCursor),
      ancientCursor: deserializeCursor((raw as Record<string, unknown>).ancientCursor),
    }
  } catch (err) {
    logger.error('[internal] repair-gateway-payments: failed to load the persisted scan cursor, restarting the sweep from the oldest row', { err })
    return NULL_CURSOR_STATE
  }
}

async function persistCursorState(
  moduleConfigService: ModuleConfigService | undefined,
  scope: RepairScope,
  state: RepairCursorState,
): Promise<void> {
  if (!moduleConfigService) return
  try {
    await moduleConfigService.setValue(
      REPAIR_CURSOR_CONFIG_MODULE_ID,
      repairCursorConfigName(scope.organizationId),
      { mainCursor: serializeCursor(state.mainCursor), ancientCursor: serializeCursor(state.ancientCursor) },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  } catch (err) {
    // Correctness (not just observability) depends on this write landing — a silent
    // failure here reintroduces the starvation this worker exists to fix, so this is
    // logged loudly rather than swallowed.
    logger.error('[internal] repair-gateway-payments: failed to persist the scan cursor, next run will restart the sweep from the oldest row', { err })
  }
}

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
  mode: ScanMode,
  pageSize: number,
): Promise<CheckoutTransaction[]> {
  const where: FilterQuery<CheckoutTransaction> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'completed',
    sessionId: { $ne: null },
    orderId: { $ne: null },
    // `window` is this worker's normal, bounded-recent scan (`updatedAt >= cutoff`);
    // `ancient` is the safety-net scan for work that already aged past the cutoff
    // (`updatedAt < cutoff`) — see the comments above `REPAIR_ANCIENT_PAGE_SIZE`.
    updatedAt: mode === 'window' ? { $gte: cutoff } : { $lt: cutoff },
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
    limit: pageSize,
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
  // `configs` is a core platform module but still optional from `checkout`'s point of view
  // (per `packages/core/AGENTS.md` § Cross-Module Coupling) — when it is disabled the
  // cursor simply cannot persist and every run falls back to the old oldest-first scan.
  const moduleConfigService = tryResolve<ModuleConfigService>(container, 'moduleConfigService')

  const persistedCursorState = await loadCursorState(moduleConfigService, scope)
  const outstanding: CheckoutTransaction[] = []

  // Ancient safety-net scan: a single tiny page, run BEFORE the main window scan so the
  // longest-overdue outstanding work (if any) always gets first claim on this run's
  // `batchSize` budget rather than being crowded out by the (usually much larger) recent
  // backlog. Its own cursor keyset-pages through `updatedAt < cutoff` independently of the
  // main cursor and wraps back to `null` once a page comes back short, so it eventually
  // cycles through every structurally-eligible pre-cutoff row without ever growing its
  // per-run cost.
  const ancientPage = await fetchCandidatePage(em, scope, cutoff, persistedCursorState.ancientCursor, 'ancient', REPAIR_ANCIENT_PAGE_SIZE)
  let nextAncientCursor: TransactionCursor | null = null
  if (ancientPage.length > 0) {
    const lastAncient = ancientPage[ancientPage.length - 1]
    nextAncientCursor = ancientPage.length < REPAIR_ANCIENT_PAGE_SIZE
      ? null
      : { updatedAt: lastAncient.updatedAt, id: lastAncient.id }
    const ancientOutstanding = await filterOutstandingGatewayPayments(em, scope, ancientPage)
    if (ancientOutstanding.length > 0) {
      // #8268 review: this is the loud operational signal the lookback-only design lacked
      // — transactions that are still genuinely unrepaired despite having left the normal
      // scanning window. Nothing is lost (the safety-net scan above will keep retrying
      // them), but their mere existence means the live `recordGatewayPayment` retries and
      // this worker's normal window both already failed to recover them once.
      logger.warn('[internal] repair-gateway-payments: found transactions still outstanding after aging out of the lookback window', {
        tenantId,
        organizationId,
        count: ancientOutstanding.length,
        oldestUpdatedAt: ancientOutstanding[0]?.updatedAt ?? null,
        lookbackMs: REPAIR_LOOKBACK_MS,
      })
    }
    outstanding.push(...ancientOutstanding)
  }

  let cursor = persistedCursorState.mainCursor
  let pagesScanned = 0

  while (outstanding.length < batchSize && pagesScanned < REPAIR_MAX_PAGES) {
    const page = await fetchCandidatePage(em, scope, cutoff, cursor, 'window', REPAIR_PAGE_SIZE)
    pagesScanned += 1
    if (page.length === 0) {
      // Nothing left ahead of the cursor in the window — wrap so the next run restarts
      // the sweep from the oldest row instead of re-fetching this same empty tail forever.
      cursor = null
      break
    }
    const last = page[page.length - 1]
    outstanding.push(...(await filterOutstandingGatewayPayments(em, scope, page)))
    if (page.length < REPAIR_PAGE_SIZE) {
      // Short page: the scan caught up to "now" within the window. Wrap to `null` so the
      // next run revisits the whole window again rather than resuming from a cursor that
      // would otherwise just keep returning this same empty tail every time.
      cursor = null
      break
    }
    cursor = { updatedAt: last.updatedAt, id: last.id }
  }

  await persistCursorState(moduleConfigService, scope, { mainCursor: cursor, ancientCursor: nextAncientCursor })

  // Observability for the recovery policy the bounded scan trades away: a sweep that
  // exhausts its page budget without clearing the backlog down to `batchSize` means more
  // outstanding work sits further ahead in the window than this run reached. Nothing here
  // is lost — the cursor just persisted above means the next run resumes from exactly
  // where this one stopped, instead of re-scanning the same dead zone from the start.
  if (pagesScanned >= REPAIR_MAX_PAGES) {
    logger.warn('[internal] repair-gateway-payments: scan hit its page cap before clearing the backlog — resuming from the persisted cursor next run', {
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
