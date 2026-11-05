import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { PAYMENT_SESSION_INITIALIZATION_PRUNE_QUEUE } from './lib/session-idempotency'

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

const logger = createLogger('payment_gateways')

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export async function registerSessionInitializationPruneSchedule(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  if (!container) return false
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
    return false
  }

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  await schedulerService.register({
    id: stableScheduleUuid(
      `payment_gateways:session-initialization-prune:${scope.tenantId}:${scope.organizationId}`,
    ),
    name: 'Payment-session initialization prune',
    description: 'Delete completed payment-session initialization claims after the 24-hour replay window.',
    scopeType: 'organization',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scheduleType: 'interval',
    scheduleValue: '24h',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: PAYMENT_SESSION_INITIALIZATION_PRUNE_QUEUE,
    targetPayload: scope,
    sourceType: 'module',
    sourceModule: 'payment_gateways',
    isEnabled: true,
  })
  return true
}

async function ensureSessionInitializationPruneSchedule(
  container: import('awilix').AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  try {
    await registerSessionInitializationPruneSchedule(container, scope)
  } catch (error) {
    logger.warn('Failed to register payment-session initialization prune schedule', { err: error })
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['payment_gateways.*'],
    admin: ['payment_gateways.*'],
    employee: ['payment_gateways.view'],
  },

  async seedDefaults({ container, tenantId, organizationId }) {
    await ensureSessionInitializationPruneSchedule(container, { tenantId, organizationId })
  },
}

export default setup
