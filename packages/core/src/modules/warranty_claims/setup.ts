import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { CLAIM_TYPES } from './data/validators'
import { WarrantyClaimSequence } from './data/entities'
import { seedWarrantyClaimDictionaries } from './lib/dictionaries'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
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
    description?: string
  }) => Promise<void>
}

const assignableStaffFeatures = ['auth.users.list', 'customers.roles.view']
const connectedIntakeFeatures = ['sales.orders.view', 'catalog.products.view']

const adminFeatures = [
  'warranty_claims.*',
  'warranty_claims.claim.view',
  'warranty_claims.claim.create',
  'warranty_claims.claim.manage',
  'warranty_claims.claim.delete',
  'warranty_claims.settings.manage',
  'warranty_claims.external.submit',
  'warranty_claims.external.view',
  'warranty_claims.registration.view',
  'warranty_claims.registration.manage',
  'warranty_claims.vendor_policy.manage',
  'warranty_claims.troubleshooting.manage',
  'warranty_claims.receiving.manage',
  ...assignableStaffFeatures,
  ...connectedIntakeFeatures,
]

const ownerFeatures = [
  'warranty_claims.*',
  'warranty_claims.claim.view',
  'warranty_claims.claim.create',
  'warranty_claims.claim.manage',
  'warranty_claims.claim.delete',
  'warranty_claims.settings.manage',
  'warranty_claims.registration.view',
  'warranty_claims.registration.manage',
  'warranty_claims.vendor_policy.manage',
  'warranty_claims.troubleshooting.manage',
  'warranty_claims.receiving.manage',
  ...assignableStaffFeatures,
  ...connectedIntakeFeatures,
]

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function stableSlaSweepScheduleId(organizationId: string): string {
  return stableScheduleUuid(`warranty_claims:sla-sweep:${organizationId}`)
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: adminFeatures,
    owner: ownerFeatures,
    employee: [
      'warranty_claims.claim.view',
      'warranty_claims.claim.create',
      'warranty_claims.claim.manage',
      'warranty_claims.registration.view',
      'warranty_claims.registration.manage',
      'warranty_claims.receiving.manage',
      ...assignableStaffFeatures,
      ...connectedIntakeFeatures,
    ],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    const now = new Date()
    for (const claimType of CLAIM_TYPES) {
      const sequence = await em.findOne(WarrantyClaimSequence, {
        tenantId,
        organizationId,
        claimType,
      })
      if (!sequence) {
        em.persist(
          em.create(WarrantyClaimSequence, {
            tenantId,
            organizationId,
            claimType,
            nextNumber: 1,
            createdAt: now,
            updatedAt: now,
          })
        )
      }
    }
    await em.flush()
  },

  async seedDefaults({ em, tenantId, organizationId, container }) {
    await seedWarrantyClaimDictionaries(em, { tenantId, organizationId })
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
      return
    }

    const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
    try {
      await schedulerService.register({
        id: stableSlaSweepScheduleId(organizationId),
        name: 'Warranty claims SLA sweep',
        description: 'Enqueues tenant-scoped warranty claim SLA escalation sweeps every 900 seconds.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'interval',
        scheduleValue: '900s',
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: 'warranty_claims.sla_sweep',
        targetPayload: {
          scope: { tenantId, organizationId },
        },
        sourceType: 'module',
        sourceModule: 'warranty_claims',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('[warranty_claims] Failed to register SLA sweep schedule', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
