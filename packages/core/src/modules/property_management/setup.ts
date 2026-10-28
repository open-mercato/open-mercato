import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { LEASE_SWEEP_QUEUE } from './lib/queues'

const logger = createLogger('property_management')

const buildingManagerFeatures = [
  'property_management.view',
  'property_management.manage',
  'property_management.availability.manage',
  'property_management.leases.manage',
  'property_management.bookings.manage',
]

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
  }) => Promise<void>
}

export function stableScheduleId(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  const version = `5${hex.slice(13, 16)}`
  const variant = `${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`
}

export function leaseSweepScheduleId(organizationId: string): string {
  return stableScheduleId(`property_management:lease-sweep:${organizationId}`)
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['property_management.*'],
    employee: buildingManagerFeatures,
  },
  defaultCustomerRoleFeatures: {
    buyer: ['portal.property_bookings.view', 'portal.property_bookings.manage', 'portal.property_leases.view'],
    viewer: ['portal.property_bookings.view', 'portal.property_leases.view'],
  },

  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    try {
      await schedulerService.register({
        id: leaseSweepScheduleId(organizationId),
        name: 'Property management lease sweep',
        description: 'Ends leases past their term, expires and reminds lease proposals, and retries pending billing operations.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        scheduleValue: '5 0 * * *',
        timezone: process.env.TZ || 'UTC',
        targetType: 'queue',
        targetQueue: LEASE_SWEEP_QUEUE,
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'property_management',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Failed to register the lease sweep schedule', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
