import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
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

  try {
    // Same order as the revert subscriber's own comment names it ("`revertUsage` +
    // `revertCodeUse`") — the two touch disjoint tables with no read-after-write
    // dependency between them, so this is a documentation-matching choice, not a
    // correctness requirement.
    const usageService = container.resolve<PromotionUsageService>('promotionUsageService')
    await usageService.reinstateUsage(em, { orderId }, scope)

    const codeService = container.resolve<PromotionCodeService>('promotionCodeService')
    await codeService.reinstateCodeUse(em, { orderId }, scope)
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
}
