import crypto from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

function buildSyntheticAuthContext(tenantId: string, organizationId: string): AuthContext {
  return {
    sub: 'system',
    tenantId,
    orgId: organizationId,
    roles: ['superadmin'],
    isSuperAdmin: true,
  } as AuthContext
}

function stableUuidFromString(input: string): string {
  const bytes = crypto.createHash('sha256').update(input).digest().subarray(0, 16)
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
    targetPayload: Record<string, unknown>
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }) => Promise<void>
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['subscriptions.*'],
    admin: ['subscriptions.*'],
    'external-app-billing': [
      'subscriptions.access',
      'subscriptions.manage',
      'subscriptions.view',
    ],
  },

  async seedDefaults({ tenantId, organizationId, container }) {
    try {
      const commandBus = container.resolve('commandBus') as CommandBus
      await commandBus.execute(
        'subscriptions.plans.sync',
        {
          input: {},
          ctx: {
            container,
            auth: buildSyntheticAuthContext(tenantId, organizationId),
            organizationScope: null,
            selectedOrganizationId: organizationId,
            organizationIds: [organizationId],
          },
        },
      )
    } catch (error) {
      console.warn('[subscriptions.setup] seedDefaults: plan sync skipped', error)
    }

    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }

    try {
      const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
      await schedulerService.register({
        id: stableUuidFromString(`subscriptions:reconcile:${tenantId}:${organizationId}`),
        name: 'Subscriptions reconcile',
        description: 'Refreshes stale subscriptions from the provider and removes abandoned pre-checkout mappings.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'interval',
        scheduleValue: '30m',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: 'subscriptions-reconcile',
        targetPayload: { tenantId, organizationId },
        sourceType: 'module',
        sourceModule: 'subscriptions',
        isEnabled: true,
      })
    } catch (error) {
      console.warn('[subscriptions.setup] seedDefaults: reconcile schedule skipped', error)
    }
  },
}

export default setup
