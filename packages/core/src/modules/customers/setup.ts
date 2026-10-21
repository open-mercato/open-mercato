import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import {
  CustomerLeadLostReason,
  CustomerLeadPipeline,
  CustomerLeadPipelineStage,
} from './data/entities'
import {
  ensureCustomerCustomFieldDefinitions,
  seedCustomerDictionaries,
  seedCurrencyDictionary,
  seedCustomerExamples,
  seedDefaultPipeline,
} from './cli'
import { ensureDictionaryEntry } from './commands/shared'
import { DEFAULT_CUSTOMER_ROLE_TYPES } from './lib/customerRoleTypes'

const LEAD_PIPELINE_CODE = 'default'
const LEAD_STAGES = [
  { code: 'new', name: 'New', kind: 'open' as const, position: 0 },
  { code: 'contacted', name: 'Contacted', kind: 'open' as const, position: 1 },
  { code: 'qualified', name: 'Qualified', kind: 'open' as const, position: 2 },
  { code: 'won', name: 'Won', kind: 'won' as const, position: 3 },
  { code: 'lost', name: 'Lost', kind: 'lost' as const, position: 4 },
]
const LEAD_LOST_REASONS = [
  { code: 'price', name: 'Price' },
  { code: 'timing', name: 'Timing' },
  { code: 'no-response', name: 'No response' },
  { code: 'competitor', name: 'Chose a competitor' },
]

async function seedDefaultLeadPipeline(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  const pipeline = await em.findOne(CustomerLeadPipeline, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code: LEAD_PIPELINE_CODE,
  })
  if (!pipeline) {
    const created = em.create(CustomerLeadPipeline, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: 'Default lead pipeline',
      code: LEAD_PIPELINE_CODE,
      isDefault: true,
      isActive: true,
    })
    em.persist(created)
    await em.flush()
    for (const stage of LEAD_STAGES) {
      em.persist(em.create(CustomerLeadPipelineStage, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        pipelineId: created.id,
        code: stage.code,
        name: stage.name,
        kind: stage.kind,
        position: stage.position,
        isActive: true,
      }))
    }
    for (let index = 0; index < LEAD_LOST_REASONS.length; index += 1) {
      const reason = LEAD_LOST_REASONS[index]
      em.persist(em.create(CustomerLeadLostReason, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        pipelineId: created.id,
        code: reason.code,
        name: reason.name,
        sortOrder: index,
        isActive: true,
      }))
    }
    await em.flush()
    return
  }
  const stageCount = await em.count(CustomerLeadPipelineStage, {
    pipelineId: pipeline.id,
  })
  if (stageCount === 0) {
    for (const stage of LEAD_STAGES) {
      em.persist(em.create(CustomerLeadPipelineStage, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        pipelineId: pipeline.id,
        code: stage.code,
        name: stage.name,
        kind: stage.kind,
        position: stage.position,
        isActive: true,
      }))
    }
    await em.flush()
  }
}

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
    await seedDefaultLeadPipeline(ctx.em, scope)
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
      'customers.people.view',
      'customers.people.manage',
      'customers.companies.view',
      'customers.companies.manage',
      'customers.deals.view',
      'customers.deals.manage',
      'customers.leads.view',
      'customers.leads.create',
      'customers.leads.update',
      'customers.leads.assign',
      'customers.leads.stage',
      'customers.leads.convert',
      'customers.leads.link',
      'customers.leads.source.view',
      'customers.activities.view',
      'customers.activities.manage',
      'customers.pipelines.view',
      'customers.interactions.view',
      'customers.widgets.todos',
      'customers.widgets.next-interactions',
      'customers.widgets.new-customers',
      'customers.widgets.new-deals',
      'customers.roles.view',
      'customers.roles.manage',
      'customers.email.compose',
    ],
  },
}

export default setup
