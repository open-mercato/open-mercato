import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { StaffSupportRoutingRule, StaffTimeProject, StaffTimeTaskStatus } from '../../data/entities'
import { seedProjectTaskStatuses } from '../timesheets-tasks/seedProjectStatuses'
import type { TaskStatusLabelTranslate } from '../timesheets-tasks/defaultStatusTemplate'
import { deriveProjectCode } from '../time-tracking/projectCode'
import { seedSupportTicketCategories } from './dictionaries'

export const SUPPORT_FALLBACK_PROJECT_NAME = 'Customer support'

type SupportScope = {
  tenantId: string
  organizationId: string
}

export type ProjectCodeGenerator = (name: string, taken: Set<string>) => string

export type EnsureFallbackResult = {
  ruleId: string
  timeProjectId: string
  created: boolean
  /** Board columns seeded for a freshly created project; empty when nothing was created. */
  taskStatusIds: string[]
}

type ProjectCodeResolverLike = { generate(name: string, taken: Set<string>): string }

/**
 * The `timeProjectCodeResolver` DI override (EP-39), so a seeded project gets the
 * same code a project created through the UI would. `undefined` (built-in
 * generator) when the container does not carry one.
 */
export function resolveContainerProjectCodeGenerator(
  container: { resolve: (name: string) => unknown } | null | undefined,
): ProjectCodeGenerator | undefined {
  if (!container) return undefined
  try {
    const resolver = container.resolve('timeProjectCodeResolver') as ProjectCodeResolverLike | undefined
    if (!resolver || typeof resolver.generate !== 'function') return undefined
    return (name, taken) => resolver.generate(name, taken)
  } catch {
    return undefined
  }
}

export async function seedSupportDefaults(
  em: EntityManager,
  scope: SupportScope,
  options: { translate: TaskStatusLabelTranslate; generateCode?: ProjectCodeGenerator },
): Promise<void> {
  await seedSupportTicketCategories(em, scope)
  await ensureFallbackProjectAndRule(em, scope, {
    translate: options.translate,
    generateCode: options.generateCode,
    projectName: options.translate('staff.support.fallbackProject.name', SUPPORT_FALLBACK_PROJECT_NAME),
  })
}

async function findFallbackRule(em: EntityManager, scope: SupportScope): Promise<StaffSupportRoutingRule | null> {
  return em.findOne(StaffSupportRoutingRule, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    categoryValue: null,
    deletedAt: null,
  })
}

/**
 * Idempotent: an existing fallback rule is returned untouched, and a call that
 * loses a race to a concurrent one (unique index on the fallback rule or on the
 * project code) re-reads the winner's rule and reports `created: false`.
 */
export async function ensureFallbackProjectAndRule(
  em: EntityManager,
  scope: SupportScope,
  options: { translate: TaskStatusLabelTranslate; generateCode?: ProjectCodeGenerator; projectName?: string },
): Promise<EnsureFallbackResult> {
  const existingRule = await findFallbackRule(em, scope)
  if (existingRule) {
    return { ruleId: existingRule.id, timeProjectId: existingRule.timeProjectId, created: false, taskStatusIds: [] }
  }
  const takenRows = await em.find(
    StaffTimeProject,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { fields: ['code'] },
  )
  const taken = new Set(takenRows.map((row) => row.code))
  const name = options.projectName ?? SUPPORT_FALLBACK_PROJECT_NAME
  const generate = options.generateCode ?? ((projectName: string, codes: Set<string>) => deriveProjectCode(projectName, codes))
  const now = new Date()
  const project = em.create(StaffTimeProject, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    name,
    code: generate(name, taken),
    customerId: null,
    customerSnapshot: null,
    projectType: 'internal',
    status: 'active',
    billableByDefault: false,
    budgetKind: 'none',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  let rule: StaffSupportRoutingRule | null = null
  let statuses: StaffTimeTaskStatus[] = []
  try {
    await withAtomicFlush(
      em,
      [
        () => {
          em.persist(project)
        },
        () => {
          statuses = seedProjectTaskStatuses(
            em,
            { tenantId: scope.tenantId, organizationId: scope.organizationId, timeProjectId: project.id },
            options.translate,
          )
          rule = em.create(StaffSupportRoutingRule, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            categoryValue: null,
            timeProjectId: project.id,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          em.persist(rule)
        },
      ],
      { transaction: true, label: 'staff.support.ensure_fallback_project' },
    )
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    const winner = await findFallbackRule(em.fork(), scope)
    if (!winner) throw err
    return { ruleId: winner.id, timeProjectId: winner.timeProjectId, created: false, taskStatusIds: [] }
  }
  const created = rule as StaffSupportRoutingRule | null
  if (!created) throw new Error('[internal] fallback routing rule was not created')
  return {
    ruleId: created.id,
    timeProjectId: project.id,
    created: true,
    taskStatusIds: statuses.map((status) => status.id),
  }
}
