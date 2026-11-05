import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

export const setup: ModuleSetupConfig = {
  async seedDefaults({ em }: { em: EntityManager }) {
    const existing = await em.findOne(FeatureToggle, { identifier: 'portal_enabled', deletedAt: null })
    if (existing) return

    const toggle = em.create(FeatureToggle, {
      identifier: 'portal_enabled',
      name: 'Portal Enabled',
      description: 'Controls whether the customer portal is accessible. When disabled, all portal routes show "Portal not available".',
      category: 'portal',
      type: 'boolean',
      defaultValue: true as any,
    })
    em.persist(toggle)
    await em.flush()
  },
}

export default setup
