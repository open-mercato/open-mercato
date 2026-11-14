import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import crypto from 'node:crypto'

function stableUuidFromString(input: string): string {
  const bytes = crypto.createHash('sha256').update(input).digest().subarray(0, 16)
  // RFC4122: set version (5) and variant (10xx)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex') // 32 hex chars
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

type SchedulerServiceLike = {
  unregister?: (scheduleId: string) => Promise<void>
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

async function ensureHealthProbeSchedule(ctx: {
  container: import('awilix').AwilixContainer
  organizationId: string
  tenantId: string
}, legacyScheduleId?: string): Promise<void> {
  const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const schedulerService = ctx.container.resolve('schedulerService') as SchedulerServiceLike
  if (legacyScheduleId && typeof schedulerService.unregister === 'function') {
    await schedulerService.unregister(legacyScheduleId)
  }
  await schedulerService.register({
    id: stableUuidFromString(`integrations:health-probe:${ctx.tenantId}:${ctx.organizationId}`),
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
      stableUuidFromString(`integrations:health-probe:${tenantId}`),
    )
  },

  async onOrganizationCreated({ container, organizationId, tenantId }) {
    await ensureHealthProbeSchedule({ container, organizationId, tenantId })
  },
}

export default setup
