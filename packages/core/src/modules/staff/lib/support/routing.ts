import type { EntityManager } from '@mikro-orm/postgresql'
import {
  StaffSupportRoutingRule,
  StaffTimeProject,
  StaffTimeTaskStatus,
  type StaffSupportRoutedVia,
} from '../../data/entities'

export type SupportScope = {
  tenantId: string
  organizationId: string
}

export type SupportRoutingRuleView = {
  id: string
  categoryValue: string | null
  timeProjectId: string
  isActive: boolean
  updatedAt?: Date | null
}

export type SupportRoute = {
  timeProjectId: string
  via: StaffSupportRoutedVia
}

export function resolveSupportRouteFromRules(
  rules: SupportRoutingRuleView[],
  categoryValue: string,
  usableProjectIds: ReadonlySet<string>,
): SupportRoute | null {
  const categoryRule = rules.find((rule) => rule.categoryValue === categoryValue)
  if (categoryRule && categoryRule.isActive && usableProjectIds.has(categoryRule.timeProjectId)) {
    return { timeProjectId: categoryRule.timeProjectId, via: 'category' }
  }
  const fallbackRule = rules.find((rule) => rule.categoryValue === null)
  if (fallbackRule && usableProjectIds.has(fallbackRule.timeProjectId)) {
    return { timeProjectId: fallbackRule.timeProjectId, via: 'fallback' }
  }
  return null
}

export async function loadSupportRoutingRules(
  em: EntityManager,
  scope: SupportScope,
): Promise<SupportRoutingRuleView[]> {
  const rows = await em.find(StaffSupportRoutingRule, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  return rows.map((row) => ({
    id: row.id,
    categoryValue: row.categoryValue ?? null,
    timeProjectId: row.timeProjectId,
    isActive: row.isActive,
    updatedAt: row.updatedAt ?? null,
  }))
}

export async function loadUsableSupportProjectIds(
  em: EntityManager,
  scope: SupportScope,
  projectIds: string[],
): Promise<Set<string>> {
  const unique = Array.from(new Set(projectIds))
  if (unique.length === 0) return new Set()
  const projects = await em.find(
    StaffTimeProject,
    {
      id: { $in: unique },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      status: { $in: ['active', 'on_hold'] },
    },
    { fields: ['id'] },
  )
  if (projects.length === 0) return new Set()
  const defaults = await em.find(
    StaffTimeTaskStatus,
    {
      timeProjectId: { $in: projects.map((project) => project.id) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isDefault: true,
      deletedAt: null,
    },
    { fields: ['timeProjectId'] },
  )
  return new Set(defaults.map((status) => status.timeProjectId))
}

export async function resolveSupportRoute(
  em: EntityManager,
  scope: SupportScope,
  categoryValue: string,
): Promise<SupportRoute | null> {
  const rules = await loadSupportRoutingRules(em, scope)
  const usable = await loadUsableSupportProjectIds(em, scope, rules.map((rule) => rule.timeProjectId))
  return resolveSupportRouteFromRules(rules, categoryValue, usable)
}

export async function resolveRoutableCategoryValues(
  em: EntityManager,
  scope: SupportScope,
  categoryValues: string[],
): Promise<Map<string, SupportRoute>> {
  const rules = await loadSupportRoutingRules(em, scope)
  const usable = await loadUsableSupportProjectIds(em, scope, rules.map((rule) => rule.timeProjectId))
  const routes = new Map<string, SupportRoute>()
  for (const value of categoryValues) {
    const route = resolveSupportRouteFromRules(rules, value, usable)
    if (route) routes.set(value, route)
  }
  return routes
}
