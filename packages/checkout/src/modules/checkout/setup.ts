import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createHash } from 'node:crypto'
import { ensureCheckoutFieldsetsAndDefinitions } from './seed/customFields'
import { seedCheckoutExamples } from './seed/examples'
import { CHECKOUT_EXPIRY_QUEUE } from './workers/transaction-expiry.worker'
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
  },

  defaultRoleFeatures: {
    superadmin: ['checkout.*'],
    admin: ['checkout.view', 'checkout.create', 'checkout.edit', 'checkout.delete', 'checkout.viewPii', 'checkout.export'],
    employee: ['checkout.view'],
  },

  async seedExamples(ctx) {
    await seedCheckoutExamples(ctx)
  },
}

export default setup
