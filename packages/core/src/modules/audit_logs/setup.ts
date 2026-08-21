import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  ACCESS_LOG_RETENTION_QUEUE,
  resolveAccessLogRetentionBatchSize,
  resolveAccessLogRetentionDays,
} from '@open-mercato/core/modules/audit_logs/services/accessLogService'

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

const logger = createLogger('audit_logs').child({ component: 'setup' })

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export async function registerAccessLogRetentionSchedules(
  container: import('awilix').AwilixContainer | undefined,
  scope: { organizationId: string; tenantId: string },
): Promise<void> {
  if (!container) return
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  for (const accessClass of ['core', 'non_core'] as const) {
    await schedulerService.register({
      id: stableScheduleUuid(`audit_logs:access-retention:${accessClass}:${scope.tenantId}`),
      name: `Access-log retention (${accessClass})`,
      description: 'Delete access logs after the configured retention period in bounded batches.',
      scopeType: 'organization',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      scheduleType: 'cron',
      scheduleValue: '0 3 * * *',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: ACCESS_LOG_RETENTION_QUEUE,
      targetPayload: {
        accessClass,
        batchSize: resolveAccessLogRetentionBatchSize(),
        retentionDays: resolveAccessLogRetentionDays(accessClass),
        tenantId: scope.tenantId,
      },
      sourceType: 'module',
      sourceModule: 'audit_logs',
      isEnabled: true,
    })
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['audit_logs.*'],
    employee: ['audit_logs.view_self', 'audit_logs.undo_self'],
  },

  async seedDefaults({ container, organizationId, tenantId }) {
    try {
      await registerAccessLogRetentionSchedules(container, { organizationId, tenantId })
    } catch (error) {
      logger.warn('Failed to register access-log retention schedules', { err: error })
    }
  },
}

export default setup
