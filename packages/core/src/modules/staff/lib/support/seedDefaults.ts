import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { StaffSupportRoutingRule, StaffTimeProject } from '../../data/entities'
import { seedProjectTaskStatuses } from '../timesheets-tasks/seedProjectStatuses'
import type { TaskStatusLabelTranslate } from '../timesheets-tasks/defaultStatusTemplate'
import { deriveProjectCode } from '../time-tracking/projectCode'
import { seedSupportTicketCategories } from './dictionaries'

export const SUPPORT_FALLBACK_PROJECT_NAME = 'Customer support'

type SupportScope = {
  tenantId: string
  organizationId: string
}

type ProjectCodeGenerator = (name: string, taken: Set<string>) => string

export type EnsureFallbackResult = {
  ruleId: string
  timeProjectId: string
  created: boolean
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

export async function ensureFallbackProjectAndRule(
  em: EntityManager,
  scope: SupportScope,
  options: { translate: TaskStatusLabelTranslate; generateCode?: ProjectCodeGenerator; projectName?: string },
): Promise<EnsureFallbackResult> {
  const existingRule = await em.findOne(StaffSupportRoutingRule, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    categoryValue: null,
    deletedAt: null,
  })
  if (existingRule) {
    return { ruleId: existingRule.id, timeProjectId: existingRule.timeProjectId, created: false }
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
  await withAtomicFlush(
    em,
    [
      () => {
        em.persist(project)
      },
      () => {
        seedProjectTaskStatuses(
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
  const created = rule as StaffSupportRoutingRule | null
  if (!created) throw new Error('[internal] fallback routing rule was not created')
  return { ruleId: created.id, timeProjectId: project.id, created: true }
}
