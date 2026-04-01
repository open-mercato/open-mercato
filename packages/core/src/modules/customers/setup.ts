import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import {
  ensureCustomerCustomFieldDefinitions,
  seedCustomerDictionaries,
  seedCurrencyDictionary,
  seedCustomerExamples,
  seedDefaultPipeline,
} from './cli'

const interactionFeatureToggles = [
  {
    identifier: 'customers.interactions.unified',
    name: 'Unified Interactions',
    description: 'When enabled, interactions use the unified canonical model instead of per-entity activity tracking.',
    category: 'customers',
    type: 'boolean' as const,
    defaultValue: false,
  },
  {
    identifier: 'customers.interactions.legacy-adapters',
    name: 'Interaction Legacy Adapters',
    description: 'When enabled, legacy activity/todo APIs are bridged to the canonical interaction model.',
    category: 'customers',
    type: 'boolean' as const,
    defaultValue: true,
  },
  {
    identifier: 'customers.interactions.external-sync',
    name: 'Interaction External Sync',
    description: 'When enabled, interactions can be synced from external systems (calendars, email providers).',
    category: 'customers',
    type: 'boolean' as const,
    defaultValue: false,
  },
]

async function seedInteractionFeatureToggles(em: EntityManager): Promise<void> {
  for (const toggle of interactionFeatureToggles) {
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
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedCustomerDictionaries(ctx.em, scope)
    await seedCurrencyDictionary(ctx.em, scope)
    await seedDefaultPipeline(ctx.em, scope)
    await ensureCustomerCustomFieldDefinitions(ctx.em, ctx.tenantId)
    await seedInteractionFeatureToggles(ctx.em)
  },

  seedExamples: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    await seedCustomerExamples(ctx.em, ctx.container, scope)
  },

  defaultRoleFeatures: {
    admin: [
      'customers.*',
    ],
    employee: [
      'customers.people.view',
      'customers.people.manage',
      'customers.companies.view',
      'customers.companies.manage',
      'customers.deals.view',
      'customers.deals.manage',
      'customers.activities.view',
      'customers.activities.manage',
      'customers.pipelines.view',
      'customers.interactions.view',
      'customers.widgets.todos',
      'customers.widgets.next-interactions',
      'customers.widgets.new-customers',
      'customers.widgets.new-deals',
    ],
  },
}

export default setup
