import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

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
      id: `integrations:health-probe:${tenantId}`,
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
