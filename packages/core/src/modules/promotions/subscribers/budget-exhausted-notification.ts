import { createUsageReinstateBlockedNotification, type ResolverContainer } from '../lib/usageAccountingNotifications'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('promotions')

// #8268 review Major 7. `promotions.promotion.budget_exhausted` fires both when
// `registerUsage` first exhausts a promotion's budget during an ordinary checkout — the
// caller (`submit.ts`) compensates/cancels the order synchronously, so there is nothing for
// staff to reconcile — and when `reinstateUsage` (`lib/promotion-usage-service.ts`) refuses
// to revive a PREVIOUSLY-reverted usage row on order confirmation, which leaves a confirmed
// order carrying its original discount with no usage counted anywhere. #8268 review Major 8:
// only the second (`origin: 'reinstate'`) case is actionable, so this only notifies for it —
// notifying on the first would mislabel a normal checkout decline as a revived-order
// accounting problem.
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
  // Absent on events emitted before this field existed — treat as the actionable
  // `reinstate` case, the only origin this event had before `register` started carrying it.
  const origin = readString(record, 'origin') ?? 'reinstate'

  if (!orderId || !tenantId || !organizationId) {
    logger.debug('[promotions:budget-exhausted-notification] skipped incomplete payload', {
      hasOrderId: Boolean(orderId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  if (origin !== 'reinstate') {
    logger.debug('[promotions:budget-exhausted-notification] skipped — ordinary checkout refusal, not a revived-order gap', {
      orderId,
      origin,
    })
    return
  }

  // #8268 review Major 7: a persistent subscriber's failure must propagate so the queue
  // retries the job — swallowing it here silently drops the staff alert on a transient
  // notification-service failure.
  try {
    await createUsageReinstateBlockedNotification(resolveContainer(ctx), {
      tenantId,
      organizationId,
      orderId,
      reason: 'budget_exhausted',
    })
  } catch (err) {
    logger.error('[internal] promotions:budget-exhausted-notification create failed', { err, orderId, tenantId, organizationId })
    getTelemetryRuntime()?.reportError(err, {
      module: 'promotions',
      code: 'promotions.budget_exhausted_notification_failed',
      attributes: { orderId, tenantId, organizationId },
    })
    throw err
  }
}
