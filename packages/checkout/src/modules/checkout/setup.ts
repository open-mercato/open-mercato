import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createHash } from 'node:crypto'
import { ensureCheckoutFieldsetsAndDefinitions } from './seed/customFields'
import { seedCheckoutExamples } from './seed/examples'
import { CHECKOUT_EXPIRY_QUEUE } from './workers/transaction-expiry.worker'
import { CHECKOUT_RECOVER_STUCK_SUBMITS_QUEUE } from './workers/recover-stuck-submits.worker'
import { CHECKOUT_EXPIRE_AWAITING_PAYMENT_QUEUE } from './workers/expire-awaiting-payment.worker'
import { CHECKOUT_EXPIRE_SESSIONS_QUEUE } from './workers/expire-checkout-sessions.worker'
import { CHECKOUT_REPAIR_GATEWAY_PAYMENTS_QUEUE } from './workers/repair-gateway-payments.worker'
import { CHECKOUT_REPAIR_ORDER_COMPENSATION_QUEUE } from './workers/repair-order-compensation.worker'
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

// #8822: exported so `di.ts` can register it under a DI key for `configs`'s
// `checkout.register-schedules` upgrade action to resolve. `configs` lives in
// `@open-mercato/core`, which `checkout` depends on (never the reverse), so the upgrade
// action cannot statically import this package — it resolves the DI registration by
// string key instead, the same soft-coupling shape `AGENTS.md`'s Cross-Module Coupling
// section already prescribes for an optional peer.
export async function ensureTransactionExpirySchedule(ctx: {
  container: import('awilix').AwilixContainer
  tenantId: string
  organizationId: string
}): Promise<void> {
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
  // seed pass so an existing tenant, or a later organization, also picks this up.
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

  // Release 5, Step 4.2-fix (C1/§12: "every 5 min"). Mirrors the schedules above
  // exactly — same per-(tenant, organization) scope, same re-registration on every
  // seed pass so an existing tenant, or a later organization, also picks this up.
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

  // PR 8268 review fix (Finding 5 follow-up, §12's own "expire-checkout-sessions" job,
  // named but never scheduled since Step 2.12). Mirrors the schedules above exactly —
  // same per-(tenant, organization) scope, same re-registration on every seed pass so
  // an existing tenant, or a later organization, also picks this up.
  await schedulerService.register({
    id: stableUuidFromString(`checkout:expire-checkout-sessions:${ctx.tenantId}:${ctx.organizationId}`),
    name: 'Checkout expire sessions',
    description: 'Expires open/awaiting_approval checkout sessions past their own TTL (§12).',
    scopeType: 'organization',
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    scheduleType: 'interval',
    scheduleValue: '5m',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: CHECKOUT_EXPIRE_SESSIONS_QUEUE,
    targetPayload: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    sourceType: 'module',
    sourceModule: 'checkout',
    isEnabled: true,
  })

  // PR 8268 review fix (Medium 7): durable repair for a session-backed gateway payment
  // whose `recordGatewayPayment` in-process retries (3, immediate) all failed — mirrors
  // the schedules above exactly, same per-(tenant, organization) scope, same
  // re-registration on every seed pass.
  await schedulerService.register({
    id: stableUuidFromString(`checkout:repair-gateway-payments:${ctx.tenantId}:${ctx.organizationId}`),
    name: 'Checkout repair gateway payments',
    description: 'Retries recording a session-backed gateway payment onto its order when the live submit path\'s own immediate retries all failed.',
    scopeType: 'organization',
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    scheduleType: 'interval',
    scheduleValue: '15m',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: CHECKOUT_REPAIR_GATEWAY_PAYMENTS_QUEUE,
    targetPayload: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    sourceType: 'module',
    sourceModule: 'checkout',
    isEnabled: true,
  })

  // PR 8268 review fix (Major 2): durable repair for a session left `failed` with
  // `submitProgress: 'compensating'` after `compensateByCancellingOrder`'s own immediate
  // retries all failed to cancel the order — mirrors the schedules above exactly, same
  // per-(tenant, organization) scope, same re-registration on every seed pass.
  await schedulerService.register({
    id: stableUuidFromString(`checkout:repair-order-compensation:${ctx.tenantId}:${ctx.organizationId}`),
    name: 'Checkout repair order compensation',
    description: 'Retries cancelling an order whose checkout-session compensation failed every immediate attempt on the live submit path.',
    scopeType: 'organization',
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    scheduleType: 'interval',
    scheduleValue: '10m',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: CHECKOUT_REPAIR_ORDER_COMPENSATION_QUEUE,
    targetPayload: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    sourceType: 'module',
    sourceModule: 'checkout',
    isEnabled: true,
  })
}

export const setup: ModuleSetupConfig = {
  async seedDefaults(ctx) {
    await ensureCheckoutFieldsetsAndDefinitions(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    await ensureTransactionExpirySchedule(ctx)
  },

  async onOrganizationCreated(ctx) {
    await ensureTransactionExpirySchedule(ctx)
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
