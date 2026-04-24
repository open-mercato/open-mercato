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
import { ensureDictionaryEntry } from './commands/shared'
import { DEFAULT_CUSTOMER_ROLE_TYPES } from './lib/customerRoleTypes'

const interactionFeatureToggles = [
  {
    identifier: 'customers.interaction.unified',
    name: 'Unified Interactions',
    description: 'When enabled, interactions use the unified canonical model instead of per-entity activity tracking.',
    category: 'customers',
    type: 'boolean' as const,
    defaultValue: false,
  },
  {
    identifier: 'customers.interaction.legacy-adapters',
    name: 'Interaction Legacy Adapters',
    description: 'When enabled, legacy activity/todo APIs are bridged to the canonical interaction model.',
    category: 'customers',
    type: 'boolean' as const,
    defaultValue: true,
  },
  {
    identifier: 'customers.interaction.external-sync',
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
    for (const entry of DEFAULT_CUSTOMER_ROLE_TYPES) {
      await ensureDictionaryEntry(ctx.em, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        kind: 'customer_role_type',
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
      })
    }
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
      'customers.person.view',
      'customers.person.manage',
      'customers.company.view',
      'customers.company.manage',
      'customers.deal.view',
      'customers.deal.manage',
      'customers.activity.view',
      'customers.activity.manage',
      'customers.pipeline.view',
      'customers.interaction.view',
      'customers.widgets.todos',
      'customers.widgets.next-interactions',
      'customers.widgets.new-customers',
      'customers.widgets.new-deals',
      'customers.roles.view',
      'customers.roles.manage',
    ],
  },
}

export default setup
