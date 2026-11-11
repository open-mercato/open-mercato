import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'
import { CodeUsage, PromotionUsage } from '../data/entities'
import { PromotionCodeService, type PromotionsCodeScope } from '../lib/code-service'
import { PromotionUsageService } from '../lib/promotion-usage-service'

const logger = createLogger('promotions').child({ component: 'order-confirmed-usage-reinstate' })

// #8268 review Major 3 / #8817: `order-cancelled-usage-revert.ts` reverts BOTH halves of a
// promotion use on `sales.order.cancelled` (the budget ledger via `revertUsage` and the
// code-usage/redemption counter via `revertCodeUse`). The #8404 fix makes undoing that
// cancellation re-emit `sales.order.confirmed` the same way the original confirmation
// did, but nothing re-registered either half for that transition — a single-use code
// read as unused again while the order it was spent on was live once more, and could be
// redeemed a second time. Same shape and same event as `customer_groups`'s own sibling
// `order-confirmed-credit-reinstate.ts`.
//
// #9073: this used to gate on the event payload's own `previousStatus === canceled`,
// which misses a revival through an intermediate status (Canceled → On hold →
// Confirmed) — the final event's `previousStatus` is `on_hold`, so the gate skipped it
// and the code stayed usable a second time. Dropped the gate entirely: `reinstateUsage`
// and `reinstateCodeUse` are each already scoped to only THIS order's own rows that
// still carry a `revertedAt` (see their own doc comments), so calling them on every
// confirmation is a safe no-op for an order that was never cancelled, and correctly
// fires no matter how many intermediate statuses a revival passes through.
export const metadata = {
  event: 'sales.order.confirmed',
  persistent: true,
  id: 'promotions:order-confirmed-usage-reinstate',
}

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveContainer(ctx: SubscriberContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

// #8268 review Major 4: enforced order-level REFUSAL policy. A refused reinstatement
// (budget/code cap already exhausted by another order — see `reinstateUsage`'s own doc
// comment for the exact "cancel A, spend on B, revive A" race) used to leave A CONFIRMED
// while retaining its original discount with no usage counted against it anywhere — a
// real, unreconciled revenue leak the staff notification alone only described, never
// closed. Of the three policy shapes the review names (refusal / repricing /
// compensation), refusal is the one this subscriber can enforce safely and reversibly
// from promotions alone: re-cancelling the order removes the unbacked discount by
// removing the live order entirely (through the EXACT same `sales.order.cancelled`
// cascade a normal cancel uses, so stock/credit/other modules unwind consistently too),
// is undone by staff reviving the order again once the underlying cap clears, and reuses
// the established cancel-on-failure pattern checkout's own `compensateByCancellingOrder`
// already relies on elsewhere in this release. Repricing (silently changing a CONFIRMED
// order's total) or a promotions-only compensating ledger entry (leaving the order live
// with a discount no one priced) were both rejected as carrying either billing/compliance
// risk or no actual fix to the live total — this is deliberately the conservative default,
// not the only valid one; override it if product guidance says otherwise.
async function resolveCanceledStatusEntryId(
  em: EntityManager,
  scope: PromotionsCodeScope,
): Promise<string | null> {
  const row = await em
    .getKysely<{
      dictionaries: { id: string; tenant_id: string; organization_id: string; key: string; deleted_at: Date | null }
      dictionary_entries: { id: string; dictionary_id: string; tenant_id: string; organization_id: string; normalized_value: string }
    }>()
    .selectFrom('dictionary_entries')
    .innerJoin('dictionaries', 'dictionaries.id', 'dictionary_entries.dictionary_id')
    .select(['dictionary_entries.id as id'])
    .where('dictionaries.tenant_id', '=', scope.tenantId)
    .where('dictionaries.organization_id', '=', scope.organizationId)
    .where('dictionaries.key', '=', 'sales.order_status')
    .where('dictionaries.deleted_at', 'is', null)
    .where('dictionary_entries.tenant_id', '=', scope.tenantId)
    .where('dictionary_entries.organization_id', '=', scope.organizationId)
    .where('dictionary_entries.normalized_value', 'in', ['canceled', 'cancelled'])
    .executeTakeFirst()
  return row?.id ?? null
}

const lifecycleLockKey = (orderId: string) => `promotions_usage_lifecycle:${orderId}`

// #8268 re-review Finding 2: the refusal decision and the cancellation used to commit in
// separate transactions, so a concurrent confirmation handler could reinstate this order's
// usage in between and the cancel would still remove a revival that was by then fully
// backed. The cancel now carries its own fence: `sales.orders.update` runs
// `beforeTransactionalWrite` inside its transaction right after locking the order row, and
// this fence takes the same lifecycle advisory lock there and re-validates both the
// observed order status and that this order still carries unreconciled (reverted) usage.
// Any concurrent reinstate or revert for this order waits on that lock until the cancel
// commits, then sees the order cancelled through its own stale-event fence. Nothing is
// held across connections: this handler's own lock transaction has already committed.
class RefusalSupersededError extends Error {
  constructor(readonly reason: 'order_lifecycle_changed' | 'usage_backed') {
    super(`[internal] promotions:order-confirmed-usage-reinstate refusal superseded (${reason})`)
  }
}

async function readOrderStatus(
  em: EntityManager,
  orderId: string,
  scope: PromotionsCodeScope,
): Promise<string | null> {
  const rows = await em.execute(
    'select status from sales_orders where id = ? and tenant_id = ? and organization_id = ? limit 1',
    [orderId, scope.tenantId, scope.organizationId],
  )
  return Array.isArray(rows) && rows.length > 0
    ? (rows[0] as { status?: string | null }).status ?? null
    : null
}

function isLiveOrderStatus(status: string | null): status is string {
  return status != null && status !== 'canceled' && status !== 'cancelled'
}

async function hasUnreconciledUsage(em: EntityManager, orderId: string, scope: PromotionsCodeScope): Promise<boolean> {
  const where = {
    orderId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    revertedAt: { $ne: null },
  }
  const revertedUsage = await em.findOne(PromotionUsage, where)
  if (revertedUsage) return true
  const revertedCodeUse = await em.findOne(CodeUsage, where)
  return Boolean(revertedCodeUse)
}

async function assertRefusalStillWarranted(
  salesTx: EntityManager,
  orderId: string,
  scope: PromotionsCodeScope,
  observedStatus: string,
): Promise<void> {
  await salesTx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lifecycleLockKey(orderId)])
  const currentStatus = await readOrderStatus(salesTx, orderId, scope)
  if (currentStatus !== observedStatus) throw new RefusalSupersededError('order_lifecycle_changed')
  if (!(await hasUnreconciledUsage(salesTx, orderId, scope))) throw new RefusalSupersededError('usage_backed')
}

async function refuseRevivalForUnreconciledUsage(
  container: ResolverContainer,
  em: EntityManager,
  orderId: string,
  scope: PromotionsCodeScope,
  observedStatus: string,
): Promise<void> {
  const canceledEntryId = await resolveCanceledStatusEntryId(em, scope)
  if (!canceledEntryId) {
    logger.error('[internal] promotions:order-confirmed-usage-reinstate could not resolve a canceled status entry to enforce the refusal policy', {
      orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    getTelemetryRuntime()?.reportError(new Error('[internal] no sales.order_status "canceled" dictionary entry'), {
      module: 'promotions',
      code: 'promotions.order_confirmed_usage_reinstate_refusal_policy_failed',
      attributes: { orderId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    })
    // #8268 review Finding 7: this subscriber is `persistent: true` — the dispatcher
    // retries on a thrown error, so throwing keeps redelivery going until the missing
    // `sales.order_status` "canceled" entry exists and the cancel can go through.
    throw new Error('[internal] promotions:order-confirmed-usage-reinstate could not resolve a canceled status entry to enforce the refusal policy')
  }
  const commandBus = container.resolve<CommandBus>('commandBus')
  const { ctx: trustedCtx } = buildTrustedCommandContext({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorType: 'system',
    reason: `promotions:order-confirmed-usage-reinstate:refuse:${orderId}`,
  })
  await commandBus.execute('sales.orders.update', {
    input: { id: orderId, statusEntryId: canceledEntryId },
    ctx: {
      ...trustedCtx,
      container,
      beforeTransactionalWrite: (salesTx: EntityManager) => assertRefusalStillWarranted(salesTx, orderId, scope, observedStatus),
    } as unknown as CommandRuntimeContext,
  })
}

type ReinstateOutcome =
  | { kind: 'skipped' }
  | { kind: 'reinstated' }
  | { kind: 'blocked'; observedStatus: string }

async function reinstateUsageUnderLock(
  container: ResolverContainer,
  em: EntityManager,
  orderId: string,
  scope: PromotionsCodeScope,
): Promise<ReinstateOutcome> {
  return em.transactional(async (tx) => {
    // #8268 review Major 6: takes the SAME advisory transaction lock, keyed by this
    // order, as `order-cancelled-usage-revert.ts`'s revert handler — see that file's
    // comment for the exact race this closes.
    await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lifecycleLockKey(orderId)])

    // #8268 review Major 3 (re-review): only reinstate when the order still exists and is
    // not currently cancelled (either spelling sales recognizes), so a delayed or
    // redelivered confirmation never re-registers usage for an order that is no longer
    // live. Read on the lock transaction's own connection, never a second pooled one.
    const currentStatus = await readOrderStatus(tx, orderId, scope)
    if (!isLiveOrderStatus(currentStatus)) {
      logger.debug('[internal] promotions:order-confirmed-usage-reinstate skipped stale confirmation redelivery — order no longer live', {
        orderId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        currentStatus,
      })
      return { kind: 'skipped' }
    }

    const usageService = container.resolve<PromotionUsageService>('promotionUsageService')
    const usageResult = await usageService.reinstateUsage(tx, { orderId }, scope)

    const codeService = container.resolve<PromotionCodeService>('promotionCodeService')
    const codeResult = await codeService.reinstateCodeUse(tx, { orderId }, scope)

    if (usageResult.blockedCount > 0 || codeResult.blockedCount > 0) {
      return { kind: 'blocked', observedStatus: currentStatus }
    }
    return { kind: 'reinstated' }
  })
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const orderId = readString(record, 'orderId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

  if (!orderId || !tenantId || !organizationId) {
    logger.debug('[internal] promotions:order-confirmed-usage-reinstate skipped incomplete payload', {
      hasOrderId: Boolean(orderId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  const container = resolveContainer(ctx)
  let em: EntityManager
  try {
    em = container.resolve<EntityManager>('em').fork()
  } catch (error) {
    logger.error('[internal] promotions:order-confirmed-usage-reinstate failed to initialize persistence', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    throw error
  }

  const scope: PromotionsCodeScope = { tenantId, organizationId }

  let outcome: ReinstateOutcome
  try {
    outcome = await reinstateUsageUnderLock(container, em, orderId, scope)
  } catch (error) {
    logger.error('[internal] promotions:order-confirmed-usage-reinstate failed', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'promotions',
      code: 'promotions.order_confirmed_usage_reinstate_failed',
      attributes: { orderId, tenantId, organizationId },
    })
    throw error
  }

  if (outcome.kind !== 'blocked') return

  try {
    await refuseRevivalForUnreconciledUsage(container, em, orderId, scope, outcome.observedStatus)
  } catch (error) {
    if (error instanceof RefusalSupersededError) {
      logger.debug('[internal] promotions:order-confirmed-usage-reinstate skipped refusal — superseded before the cancel could commit', {
        orderId,
        tenantId,
        organizationId,
        reason: error.reason,
      })
      return
    }
    logger.error('[internal] promotions:order-confirmed-usage-reinstate failed to enforce the refusal policy', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'promotions',
      code: 'promotions.order_confirmed_usage_reinstate_refusal_policy_failed',
      attributes: { orderId, tenantId, organizationId },
    })
    throw error
  }
}
