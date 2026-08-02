import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { referenceTaskCustomFields } from './ce'
import { ReferenceTask } from './data/entities'
import { REFERENCE_TASK_ENTITY_ID } from './data/entity-id'
import type { ReferenceScope } from './data/validators'

export async function seedReferenceDefaults(em: EntityManager, scope: ReferenceScope): Promise<void> {
  await ensureCustomFieldDefinitions(
    em,
    [{ entity: REFERENCE_TASK_ENTITY_ID, fields: referenceTaskCustomFields, source: 'reference_module' }],
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}

export async function seedReferenceExamples(em: EntityManager, scope: ReferenceScope): Promise<boolean> {
  const existing = await em.findOne(ReferenceTask, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    title: 'Reference module example task',
    deletedAt: null,
  })
  if (existing) return false

  const now = new Date()
  const task = em.create(ReferenceTask, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    title: 'Reference module example task',
    description: 'Example-only encrypted description for a deliberately enabled copied module.',
    status: 'todo',
    priority: 2,
    dueAt: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  em.persist(task)
  await em.flush()
  return true
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    await seedReferenceDefaults(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
  seedExamples: async (ctx) => {
    await seedReferenceExamples(ctx.em, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
  defaultRoleFeatures: {
    admin: ['reference_module.*'],
    employee: ['reference_module.view'],
  },
}

export default setup
