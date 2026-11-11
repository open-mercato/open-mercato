import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'
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

async function refuseRevivalForUnreconciledUsage(
  container: ResolverContainer,
  em: EntityManager,
  orderId: string,
  scope: PromotionsCodeScope,
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
    // retries on a thrown error. Returning here used to acknowledge the event while the
    // order stayed CONFIRMED with refused/reverted usage and nothing left to retry the
    // cancel once an operator adds the missing `sales.order_status` "canceled" entry.
    // Throw so redelivery keeps retrying until the dictionary entry exists and the cancel
    // can actually go through.
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
    ctx: { ...trustedCtx, container } as unknown as CommandRuntimeContext,
  })
}

// #8268 review Finding 6: the advisory-lock transaction below COMMITS (releasing the
// lock) before `handle()` ever gets around to issuing the cancel outside it — see the
// comment at that call site for why the cancel must stay outside this lock. Between the
// commit and the cancel, a concurrent process can make a prior "blocked" determination
// stale (capacity freed up, or a different invocation of this same handler already
// reinstated this exact order live). Factored out so the cancel path can reacquire the
// SAME advisory lock in a fresh, short-lived transaction and re-run the exact same
// reinstate-and-check immediately before refusing, rather than trusting a snapshot taken
// before the lock was released. `reinstateUsage`/`reinstateCodeUse` are idempotent (see
// their own doc comments) — re-calling them here when nothing changed just re-confirms
// still-blocked with no double mutation, and if capacity cleared in the interim this call
// is the one that actually reinstates it live.
async function reinstateUsageUnderLock(
  container: ResolverContainer,
  em: EntityManager,
  orderId: string,
  tenantId: string,
  organizationId: string,
  scope: PromotionsCodeScope,
): Promise<boolean> {
  const lockKey = `promotions_usage_lifecycle:${orderId}`
  let blocked = false
  await em.transactional(async (tx) => {
    // #8268 review Major 6: takes the SAME advisory transaction lock, keyed by this
    // order, as `order-cancelled-usage-revert.ts`'s revert handler — see that file's
    // comment for the exact race this closes.
    await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])

    // #8268 review Major 3 (re-review): the advisory lock alone only serializes this
    // handler against `order-cancelled-usage-revert.ts` — it does not stop EITHER from
    // acting on a STALE event. Deliver a delayed/redelivered `sales.order.confirmed`
    // AFTER the order was cancelled again (or deleted): without this check the
    // serialized reinstate would still re-register usage for an order that is no
    // longer live. Only reinstate when the order still exists and is not currently
    // canceled. Sales recognizes BOTH `canceled` and `cancelled` as live cancellation
    // spellings (its own `isCancelledOrderStatus` guard, and `sales.order.cancelled`
    // fires for either) — #8268 review Major 3 (re-review): comparing against only
    // `canceled` here let a delayed confirmation reinstate usage for an order left as
    // `cancelled`.
    const current = await tx.getConnection().execute(
      'select status from sales_orders where id = ? and tenant_id = ? and organization_id = ? limit 1',
      [orderId, tenantId, organizationId],
    )
    const currentStatus = Array.isArray(current) && current.length > 0
      ? (current[0] as { status?: string | null }).status ?? null
      : null
    if (currentStatus == null || currentStatus === 'canceled' || currentStatus === 'cancelled') {
      logger.debug('[internal] promotions:order-confirmed-usage-reinstate skipped stale confirmation redelivery — order no longer live', {
        orderId,
        tenantId,
        organizationId,
        currentStatus,
      })
      return
    }

    // Same order as the revert subscriber's own comment names it ("`revertUsage` +
    // `revertCodeUse`") — the two touch disjoint tables with no read-after-write
    // dependency between them, so this is a documentation-matching choice, not a
    // correctness requirement.
    const usageService = container.resolve<PromotionUsageService>('promotionUsageService')
    const usageResult = await usageService.reinstateUsage(tx, { orderId }, scope)

    const codeService = container.resolve<PromotionCodeService>('promotionCodeService')
    const codeResult = await codeService.reinstateCodeUse(tx, { orderId }, scope)

    blocked = usageResult.blockedCount > 0 || codeResult.blockedCount > 0
  })
  return blocked
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

  let revivalRefused = false
  try {
    revivalRefused = await reinstateUsageUnderLock(container, em, orderId, tenantId, organizationId, scope)
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

  if (!revivalRefused) return

  // Outside the advisory-lock transaction above: `sales.orders.update` manages its own
  // transaction/EM fork and re-emits `sales.order.cancelled`, which this same subscriber
  // pair (and every other module's own cancel-side handler) must be free to react to —
  // nesting it inside the lock would only risk a cross-transaction deadlock for no benefit.
  try {
    // #8268 review Finding 6: re-verify the blocked condition is STILL true, under a
    // fresh reacquisition of the SAME advisory lock, immediately before issuing the
    // cancel — the snapshot taken above can go stale the instant that lock released (see
    // `reinstateUsageUnderLock`'s own doc comment: capacity can clear, or a different
    // invocation of this same handler can have already reinstated this exact order,
    // between the commit above and this point). Only refuse when this fresh check still
    // reports blocked; if it now succeeds, the order is live and reinstated — nothing
    // further to do, the idempotent reinstate call itself already applied that outcome.
    const stillBlocked = await reinstateUsageUnderLock(container, em, orderId, tenantId, organizationId, scope)
    if (!stillBlocked) {
      logger.debug('[internal] promotions:order-confirmed-usage-reinstate skipped refusal — the blocked condition resolved before the cancel could run', {
        orderId,
        tenantId,
        organizationId,
      })
      return
    }
    await refuseRevivalForUnreconciledUsage(container, em, orderId, scope)
  } catch (error) {
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
