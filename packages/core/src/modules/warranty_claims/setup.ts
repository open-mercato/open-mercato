import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { CLAIM_TYPES } from './data/validators'
import { WarrantyClaimSequence } from './data/entities'
import { seedWarrantyClaimDictionaries } from './lib/dictionaries'

const adminFeatures = [
  'warranty_claims.*',
  'warranty_claims.claim.view',
  'warranty_claims.claim.create',
  'warranty_claims.claim.manage',
  'warranty_claims.claim.delete',
  'warranty_claims.settings.manage',
]

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: adminFeatures,
    owner: adminFeatures,
    employee: ['warranty_claims.claim.view', 'warranty_claims.claim.create', 'warranty_claims.claim.manage'],
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

  async seedDefaults({ em, tenantId, organizationId }) {
    await seedWarrantyClaimDictionaries(em, { tenantId, organizationId })
  },
}

export default setup
