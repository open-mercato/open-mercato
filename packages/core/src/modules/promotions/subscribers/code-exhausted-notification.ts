import { createUsageReinstateBlockedNotification, type ResolverContainer } from '../lib/usageAccountingNotifications'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('promotions')

// #8268 review Major 7. `promotions.code.exhausted` is emitted by
// `reinstateCodeUse` (`lib/code-service.ts`) when reviving an order's code usage would
// push a capped code, or a one-shot generated code, past its own limit — the usage row
// stays reverted and the order keeps its discount uncounted. This creates the staff-facing
// notification so that gap is visible, not just logged.
export const metadata = {
  event: 'promotions.code.exhausted',
  persistent: true,
  id: 'promotions:code-exhausted-notification',
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
    logger.debug('[promotions:code-exhausted-notification] skipped incomplete payload', {
      hasOrderId: Boolean(orderId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
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
      reason: 'code_exhausted',
    })
  } catch (err) {
    logger.error('[internal] promotions:code-exhausted-notification create failed', { err, orderId, tenantId, organizationId })
    getTelemetryRuntime()?.reportError(err, {
      module: 'promotions',
      code: 'promotions.code_exhausted_notification_failed',
      attributes: { orderId, tenantId, organizationId },
    })
    throw err
  }
}
