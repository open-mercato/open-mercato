import { createHash } from 'node:crypto'
import type { InitSetupContext, ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { BOOKING_SWEEP_QUEUE, LEASE_SWEEP_QUEUE } from './lib/queues'
import { seedUnavailabilityReasons } from './lib/unavailabilityReasons'

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

export function bookingSweepScheduleId(organizationId: string): string {
  return stableScheduleId(`property_management:booking-sweep:${organizationId}`)
}

async function seedOrganizationDefaults({ em, tenantId, organizationId, container }: InitSetupContext): Promise<void> {
  try {
    await seedUnavailabilityReasons(em, { tenantId, organizationId })
  } catch (error) {
    logger.warn('Failed to seed the unavailability reasons dictionary', {
      error: error instanceof Error ? error.message : error,
    })
    getTelemetryRuntime()?.reportError(error, { module: 'property_management', code: 'property_management.unavailability_reasons_seed_failed' })
  }
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  const timezone = process.env.TZ || 'UTC'
  try {
    await schedulerService.register({
      id: leaseSweepScheduleId(organizationId),
      name: 'Property management lease sweep',
      description: 'Ends leases past their term, expires overdue lease proposals, and retries pending billing operations.',
      scopeType: 'organization',
      organizationId,
      tenantId,
      scheduleType: 'cron',
      scheduleValue: '5 0 * * *',
      timezone,
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
    getTelemetryRuntime()?.reportError(error, { module: 'property_management', code: 'property_management.lease_sweep_schedule_failed' })
  }
  try {
    await schedulerService.register({
      id: bookingSweepScheduleId(organizationId),
      name: 'Property management booking sweep',
      description: 'Completes past bookings, retries pending booking billing operations and resumes unavailabilities still cancelling bookings.',
      scopeType: 'organization',
      organizationId,
      tenantId,
      scheduleType: 'cron',
      scheduleValue: '*/15 * * * *',
      timezone,
      targetType: 'queue',
      targetQueue: BOOKING_SWEEP_QUEUE,
      targetPayload: { scope: { tenantId, organizationId } },
      sourceType: 'module',
      sourceModule: 'property_management',
      isEnabled: true,
    })
  } catch (error) {
    logger.warn('Failed to register the booking sweep schedule', {
      error: error instanceof Error ? error.message : error,
    })
    getTelemetryRuntime()?.reportError(error, { module: 'property_management', code: 'property_management.booking_sweep_schedule_failed' })
  }
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

  seedDefaults: seedOrganizationDefaults,
  onOrganizationCreated: seedOrganizationDefaults,
}

export default setup
