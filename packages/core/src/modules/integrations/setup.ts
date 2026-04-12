import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import crypto from 'node:crypto'

function stableUuidFromString(input: string): string {
  const hex = crypto.createHash('sha256').update(input).digest('hex').slice(0, 32)
  // UUID format 8-4-4-4-12; set version=5-ish and RFC variant for UUID validity
  const timeHi = `5${hex.slice(13, 16)}`
  const clockSeqHi = (parseInt(hex.slice(16, 18), 16) & 0x3f | 0x80).toString(16).padStart(2, '0')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 13) + timeHi,
    clockSeqHi + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-')
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
    targetPayload: Record<string, unknown>
    requireFeature?: string
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }) => Promise<void>
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['integrations.*', 'integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
    admin: ['integrations.*', 'integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
    employee: ['integrations.view'],
  },

  async seedDefaults({ container, organizationId, tenantId }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }

    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    await schedulerService.register({
      id: stableUuidFromString(`integrations:health-probe:${tenantId}`),
      name: 'Integration health probes',
      description: 'Runs outbound health checks for enabled integrations every 15 minutes.',
      scopeType: 'organization',
      organizationId,
      tenantId,
      scheduleType: 'interval',
      scheduleValue: '15m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'integration-health-probe',
      targetPayload: {
        scope: { organizationId, tenantId },
      },
      sourceType: 'module',
      sourceModule: 'integrations',
      isEnabled: true,
    })
  },
}

export default setup
