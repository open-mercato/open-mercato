import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { PromotionCodeService, type PromotionsCodeScope } from '../lib/code-service'
import { PromotionUsageService } from '../lib/promotion-usage-service'

const logger = createLogger('promotions').child({ component: 'order-cancelled-usage-revert' })

// Release 5 C5/SPEC-055 amendment (finding C5): "`sales` cannot depend on `promotions`
// and nothing subscribes" to the old `§3.3 'sales calls revertUsage'` text — withdrawn.
// This is the promotions-owned replacement: a persistent subscriber on
// `sales.order.cancelled` that reverses BOTH halves of what checkout's future submit
// sequence (Phase 4, Step 4.2) will have recorded for the order — the promotion-budget
// ledger (`revertUsage`, existing) and the code-usage/redemption-counter state
// (`revertCodeUse`, additive, this Step). Reads only the FK ids off the event payload,
// never imports a `sales` entity (AGENTS.md: upstream never depends on downstream).
//
// Idempotent by construction: `revertUsage` only touches `PromotionUsage` rows with
// `revertedAt IS NULL` and `revertCodeUse` only touches `CodeUsage` rows with
// `revertedAt IS NULL` — a redelivered event finds nothing left to revert on the second
// pass, same no-op-on-redelivery precedent as `customer_groups`'s own
// `order-cancelled-credit-release` subscriber for this exact event.
export const metadata = {
  event: 'sales.order.cancelled',
  persistent: true,
  id: 'promotions:order-cancelled-usage-revert',
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

// Exported so `order-deleted-usage-revert.ts` (#8406) can reuse the exact same revert
// logic for `sales.order.deleted` — deleting an order that used a promotion/code must
// free its budget and code usage the same way cancelling it does. Both services key
// purely by `orderId`/`tenantId`/`organizationId`, with no FK to the order row itself.
export async function handleOrderUsageRevert(
  payload: unknown,
  ctx: SubscriberContext,
  options: { eventId?: string } = {},
): Promise<void> {
  const eventId = options.eventId ?? 'sales.order.cancelled'
  const record = toRecord(payload)
  const orderId = readString(record, 'orderId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

  if (!orderId || !tenantId || !organizationId) {
    logger.debug('[internal] promotions:order-cancelled-usage-revert skipped incomplete payload', {
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
    logger.error('[internal] promotions:order-cancelled-usage-revert failed to initialize persistence', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    throw error
  }

  const scope: PromotionsCodeScope = { tenantId, organizationId }

  // #8268 review Major 6: a plain "is the order still deleted?" SELECT only narrows the
  // race, it does not close it — a redelivery that paused between that check and the
  // revert calls below could still observe (and re-revert) usage
  // `order-confirmed-usage-reinstate.ts` just re-registered while this handler was
  // paused. Both subscribers now take the SAME Postgres advisory transaction lock, keyed
  // by this order, around their entire check-then-act sequence — whichever started first
  // finishes its whole pass (and commits) before the other's pass is even allowed to
  // read, same fix as `customer_groups`'s credit release/reinstate pair for the identical
  // shape of race.
  const lockKey = `promotions_usage_lifecycle:${orderId}`
  try {
    await em.transactional(async (tx) => {
      await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])

      if (eventId === 'sales.order.deleted') {
        // `sales.order.deleted` is persistent (queued/retried), and the undo-of-delete
        // path can re-register this order's promotion/code usage (resetting
        // `revertedAt` back to null) before — or racing — this event's redelivery. A
        // redelivery arriving after the order exists again must not revert that fresh
        // usage; only a still-genuinely-deleted order should proceed.
        const stillDeleted = await tx.execute(
          'select 1 from sales_orders where id = ? and tenant_id = ? and organization_id = ? limit 1',
          [orderId, tenantId, organizationId],
        )
        if (Array.isArray(stillDeleted) && stillDeleted.length > 0) {
          logger.debug('[internal] promotions:order-cancelled-usage-revert skipped stale delete redelivery — order exists again', {
            orderId,
            tenantId,
            organizationId,
          })
          return
        }
      } else {
        // #8268 review Major 3: the advisory lock alone only serializes this handler
        // against `order-confirmed-usage-reinstate.ts` — it does not stop EITHER from
        // acting on a STALE event. Cancel A, revive A (reinstating its promotion/code
        // usage), then deliver a delayed/redelivered `sales.order.cancelled` for A:
        // without this check the serialized revert would still re-revert the
        // just-reinstated usage. Only a currently-canceled order gets its usage reverted.
        // Sales recognizes BOTH `canceled` and `cancelled` as live cancellation spellings
        // (its own `isCancelledOrderStatus` guard, and `sales.order.cancelled` fires for
        // either) — #8268 review Major 3 (re-review): comparing against only `canceled`
        // here let an order left as `cancelled` skip this revert entirely.
        const current = await tx.execute(
          'select status from sales_orders where id = ? and tenant_id = ? and organization_id = ? limit 1',
          [orderId, tenantId, organizationId],
        )
        const currentStatus = Array.isArray(current) && current.length > 0
          ? (current[0] as { status?: string | null }).status ?? null
          : null
        if (currentStatus !== 'canceled' && currentStatus !== 'cancelled') {
          logger.debug('[internal] promotions:order-cancelled-usage-revert skipped stale cancellation redelivery — order is no longer canceled', {
            orderId,
            tenantId,
            organizationId,
            currentStatus,
          })
          return
        }
      }

      // `revertUsage` (budget/per-order ledger bookkeeping) runs first, matching the
      // order the C5 finding itself names ("`revertUsage` + `revertCodeUse`") — the two
      // touch disjoint tables (`PromotionUsage` vs `CodeUsage`/`Code`/`GeneratedCode`)
      // with no read-after-write dependency between them, so this ordering is a
      // documentation-matching choice, not a correctness requirement.
      const usageService = container.resolve<PromotionUsageService>('promotionUsageService')
      await usageService.revertUsage(tx, { orderId }, scope)

      const codeService = container.resolve<PromotionCodeService>('promotionCodeService')
      await codeService.revertCodeUse(tx, { orderId }, scope)
    })
  } catch (error) {
    logger.error('[internal] promotions:order-cancelled-usage-revert failed', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'promotions',
      code: 'promotions.order_cancelled_usage_revert_failed',
      attributes: { orderId, tenantId, organizationId },
    })
    throw error
  }
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  return handleOrderUsageRevert(payload, ctx)
}
