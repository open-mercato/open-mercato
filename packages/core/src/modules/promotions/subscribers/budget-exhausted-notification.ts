import { createUsageReinstateBlockedNotification, type ResolverContainer } from '../lib/usageAccountingNotifications'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('promotions')

// #8268 review Major 7. `promotions.promotion.budget_exhausted` was declared but never
// consumed — it already fires both when `registerUsage` first exhausts a promotion's
// budget and when `reinstateUsage` (`lib/promotion-usage-service.ts`) refuses to revive an
// order's usage because reviving it would push the budget past its cap. Either way, this
// creates the staff-facing notification so a plain budget exhaustion is visible, not just
// logged, and the reinstate-refusal case (review Major 7) stops being silent in practice.
export const metadata = {
  event: 'promotions.promotion.budget_exhausted',
  persistent: true,
  id: 'promotions:budget-exhausted-notification',
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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
  const orderId = readString(record, 'orderId')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

  if (!orderId || !tenantId || !organizationId) {
    logger.debug('[promotions:budget-exhausted-notification] skipped incomplete payload', {
      hasOrderId: Boolean(orderId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  try {
    await createUsageReinstateBlockedNotification(resolveContainer(ctx), {
      tenantId,
      organizationId,
      orderId,
      reason: 'budget_exhausted',
    })
  } catch (err) {
    logger.warn('[promotions:budget-exhausted-notification] create failed', { err })
  }
}
