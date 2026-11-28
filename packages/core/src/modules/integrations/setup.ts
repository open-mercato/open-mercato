import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { getCrudFormSectionOutboxRuntimes } from './lib/crud-form-outbox'
import { ensureCrudFormSectionOutboxSweep, stableIntegrationScheduleId, type IntegrationScheduler } from './lib/crud-form-outbox-schedules'

async function ensureHealthProbeSchedule(ctx: {
  container: import('awilix').AwilixContainer
  organizationId: string
  tenantId: string
}, legacyScheduleId?: string): Promise<void> {
  const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const schedulerService = ctx.container.resolve<IntegrationScheduler>('schedulerService')
  if (legacyScheduleId && typeof schedulerService.unregister === 'function') {
    await schedulerService.unregister(legacyScheduleId)
  }
  await schedulerService.register({
    id: stableIntegrationScheduleId(`integrations:health-probe:${ctx.tenantId}:${ctx.organizationId}`),
    name: 'Integration health probes',
    description: 'Runs outbound health checks for enabled integrations every 15 minutes.',
    scopeType: 'organization',
    organizationId: ctx.organizationId,
    tenantId: ctx.tenantId,
    scheduleType: 'interval',
    scheduleValue: '15m',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: 'integration-health-probe',
    targetPayload: {
      scope: { organizationId: ctx.organizationId, tenantId: ctx.tenantId },
    },
    sourceType: 'module',
    sourceModule: 'integrations',
    isEnabled: true,
  })
  if (getCrudFormSectionOutboxRuntimes().size) {
    await ensureCrudFormSectionOutboxSweep(ctx.container, ctx)
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['integrations.*', 'integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
    admin: ['integrations.*', 'integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
    employee: ['integrations.view'],
  },

  async seedDefaults({ container, organizationId, tenantId }) {
    await ensureHealthProbeSchedule(
      { container, organizationId, tenantId },
      stableIntegrationScheduleId(`integrations:health-probe:${tenantId}`),
    )
  },

  async onOrganizationCreated({ container, organizationId, tenantId }) {
    await ensureHealthProbeSchedule({ container, organizationId, tenantId })
  },
}

export default setup
