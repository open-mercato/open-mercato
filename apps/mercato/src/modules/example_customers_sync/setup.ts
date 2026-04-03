import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

const syncFeatureToggles = [
  {
    identifier: 'example.customers_sync.enabled',
    name: 'Example Customers Sync Enabled',
    description: 'When enabled, canonical customer tasks are synced to the example todo module.',
    category: 'example',
    type: 'boolean' as const,
    defaultValue: false,
  },
  {
    identifier: 'example.customers_sync.bidirectional',
    name: 'Example Customers Sync Bidirectional',
    description: 'When enabled, updates from the example todo module sync back to canonical customer tasks.',
    category: 'example',
    type: 'boolean' as const,
    defaultValue: false,
  },
] as const

async function seedSyncFeatureToggles(em: EntityManager): Promise<void> {
  for (const toggle of syncFeatureToggles) {
    const existing = await em.findOne(FeatureToggle, { identifier: toggle.identifier, deletedAt: null })
    if (existing) continue
    const entity = em.create(FeatureToggle, {
      identifier: toggle.identifier,
      name: toggle.name,
      description: toggle.description,
      category: toggle.category,
      type: toggle.type,
      defaultValue: toggle.defaultValue,
    })
    em.persist(entity)
  }
  await em.flush()
}

export const setup: ModuleSetupConfig = {
  async seedDefaults({ em }) {
    await seedSyncFeatureToggles(em)
  },
  defaultRoleFeatures: {
    superadmin: ['example_customers_sync.*'],
    admin: ['example_customers_sync.*'],
  },
}

export default setup
