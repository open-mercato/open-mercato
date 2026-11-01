import type { EntityManager } from '@mikro-orm/postgresql'
import { createCreditLimitExceededNotification, type ResolverContainer } from '../lib/creditNotifications'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_groups')

// Release 5 Phase 3 (G15, Step 1.8). `customer_groups.credit.limit_exceeded` is emitted by
// `reserveCredit` on a refused reservation (`customerCreditService.ts`). This subscriber
// creates the in-app notification per spec §10.2 — recipient resolution lives in
// `lib/creditNotifications.ts`, shared with the exposure-audit job's own over-limit finding.
export const metadata = {
  event: 'customer_groups.credit.limit_exceeded',
  persistent: true,
  id: 'customer_groups:credit-limit-exceeded-notification',
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
  const creditAccountId = readString(record, 'creditAccountId')
  const customerId = readString(record, 'customerId')
  const currencyCode = readString(record, 'currencyCode') ?? ''
  const requestedAmount = readString(record, 'requestedAmount') ?? ''
  const creditLimit = readString(record, 'creditLimit') ?? ''
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

  if (!creditAccountId || !customerId || !tenantId || !organizationId) {
    logger.debug('[customer_groups:credit-limit-exceeded-notification] skipped incomplete payload', {
      hasCreditAccountId: Boolean(creditAccountId),
      hasCustomerId: Boolean(customerId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  const container = resolveContainer(ctx)
  try {
    const em = container.resolve<EntityManager>('em').fork()
    await createCreditLimitExceededNotification(em, container, {
      tenantId,
      organizationId,
      creditAccountId,
      customerId,
      currencyCode,
      requestedAmount,
      creditLimit,
    })
  } catch (err) {
    logger.warn('[customer_groups:credit-limit-exceeded-notification] create failed', { err })
  }
}
