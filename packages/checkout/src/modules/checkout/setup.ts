import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createHash } from 'node:crypto'
import { ensureCheckoutFieldsetsAndDefinitions } from './seed/customFields'
import { seedCheckoutExamples } from './seed/examples'
import { CHECKOUT_EXPIRY_QUEUE } from './workers/transaction-expiry.worker'
import { CHECKOUT_RECOVER_STUCK_SUBMITS_QUEUE } from './workers/recover-stuck-submits.worker'
import { CHECKOUT_EXPIRE_AWAITING_PAYMENT_QUEUE } from './workers/expire-awaiting-payment.worker'
export { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from './lib/defaults'

function stableUuidFromString(input: string): string {
  const bytes = createHash('sha256').update(input).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'organization'
    organizationId: string
    tenantId: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload?: Record<string, unknown>
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }) => Promise<void>
}

export const setup: ModuleSetupConfig = {
  async seedDefaults(ctx) {
    await ensureCheckoutFieldsetsAndDefinitions(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

    const schedulerService = ctx.container.resolve('schedulerService') as SchedulerServiceLike
    await schedulerService.register({
      id: stableUuidFromString(`checkout:transaction-expiry:${ctx.tenantId}:${ctx.organizationId}`),
      name: 'Checkout transaction expiry',
      description: 'Marks stale checkout transactions as expired and runs usage limit updates.',
      scopeType: 'organization',
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      scheduleType: 'interval',
      scheduleValue: '10m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: CHECKOUT_EXPIRY_QUEUE,
      sourceType: 'module',
      sourceModule: 'checkout',
      isEnabled: true,
    })

    // Release 5, Step 4.2 (B.4, §12: "every minute"). Mirrors the schedule above exactly
    // — same per-(tenant, organization) scope, same re-registration on every
    // `seedDefaults` pass so an existing tenant also picks this up.
    await schedulerService.register({
      id: stableUuidFromString(`checkout:recover-stuck-submits:${ctx.tenantId}:${ctx.organizationId}`),
      name: 'Checkout recover stuck submits',
      description: 'Probes and resumes or compensates checkout sessions stuck mid-submit (C24).',
      scopeType: 'organization',
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      scheduleType: 'interval',
      scheduleValue: '1m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: CHECKOUT_RECOVER_STUCK_SUBMITS_QUEUE,
      targetPayload: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      sourceType: 'module',
      sourceModule: 'checkout',
      isEnabled: true,
    })

    // Release 5, Step 4.2-fix (C1/§12: "every 5 min"). Mirrors the two schedules above
    // exactly — same per-(tenant, organization) scope, same re-registration on every
    // `seedDefaults` pass so an existing tenant also picks this up.
    await schedulerService.register({
      id: stableUuidFromString(`checkout:expire-awaiting-payment:${ctx.tenantId}:${ctx.organizationId}`),
      name: 'Checkout expire awaiting payment',
      description: 'Resolves checkout sessions left in awaiting_payment past their payment deadline (C1/§12): resumes on a gateway-confirmed success, otherwise compensates by cancelling the order.',
      scopeType: 'organization',
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      scheduleType: 'interval',
      scheduleValue: '5m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: CHECKOUT_EXPIRE_AWAITING_PAYMENT_QUEUE,
      targetPayload: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      sourceType: 'module',
      sourceModule: 'checkout',
      isEnabled: true,
    })
  },

  defaultRoleFeatures: {
    superadmin: ['checkout.*'],
    admin: [
      'checkout.view',
      'checkout.create',
      'checkout.edit',
      'checkout.delete',
      'checkout.viewPii',
      'checkout.export',
      // Release 5, Step 2.12 (D-R5-34): admin keeps both session features.
      'checkout.sessions.view',
      'checkout.sessions.manage',
    ],
    // Release 5, Step 2.12 (D-R5-34): least privilege — `employee` gets `.view` only;
    // `.manage` stays admin-only or is granted by hand.
    employee: ['checkout.view', 'checkout.sessions.view'],
  },

  async seedExamples(ctx) {
    await seedCheckoutExamples(ctx)
  },
}

export default setup
