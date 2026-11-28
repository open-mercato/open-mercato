import type { EntityManager } from '@mikro-orm/postgresql'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import type { DashboardWidgetMetadata } from '@open-mercato/shared/modules/dashboard/widgets'
import { DashboardRoleWidgets } from '../data/entities'
import { loadAllWidgets } from './widgets'

export const dashboardDefaultRoleNames = ['superadmin', 'admin', 'employee'] as const

type WidgetWithMetadata = { metadata: DashboardWidgetMetadata }

export function selectDefaultRoleWidgetIds(widgets: WidgetWithMetadata[], roleName: string): string[] {
  const isAdminRole = roleName === 'admin' || roleName === 'superadmin'
  return widgets.filter(({ metadata }) => isAdminRole || metadata.defaultEnabled).map(({ metadata }) => metadata.id)
}

export function selectAnalyticsWidgetIds(widgets: WidgetWithMetadata[]): string[] {
  return widgets
    .filter(({ metadata }) => metadata.category === 'analytics' || metadata.id.startsWith('dashboards.analytics.'))
    .map(({ metadata }) => metadata.id)
}

type RoleWidgetScope = {
  tenantId: string
  organizationId?: string | null
  roleNames: string[]
  widgetIds: string[]
}

export async function findRoleByName(
  em: EntityManager,
  roleName: string,
  tenantId: string,
): Promise<Role | null> {
  const tenantRole = await em.findOne(Role, { name: roleName, tenantId })
  if (tenantRole) return tenantRole
  return em.findOne(Role, { name: roleName, tenantId: null })
}

export async function resolveAnalyticsWidgetIds(): Promise<string[]> {
  return selectAnalyticsWidgetIds(await loadAllWidgets())
}

export async function appendWidgetsToRoles(
  em: EntityManager,
  { tenantId, organizationId = null, roleNames, widgetIds }: RoleWidgetScope,
): Promise<boolean> {
  const trimmedTenantId = tenantId.trim()
  const widgets = await loadAllWidgets()
  const validWidgetIds = new Set(widgets.map((widget) => widget.metadata.id))
  const resolvedWidgetIds = widgetIds.filter((id) => validWidgetIds.has(id))
  if (!resolvedWidgetIds.length) return false

  let updated = false
  await em.transactional(async (tem) => {
    for (const roleName of roleNames) {
      const role = await findRoleByName(tem, roleName, trimmedTenantId)
      if (!role) continue

      const record = await tem.findOne(DashboardRoleWidgets, {
        roleId: String(role.id),
        tenantId: trimmedTenantId,
        organizationId,
        deletedAt: null,
      })
      const roleRecord = record ?? (organizationId
        ? await tem.findOne(DashboardRoleWidgets, {
          roleId: String(role.id),
          tenantId: trimmedTenantId,
          organizationId: null,
          deletedAt: null,
        })
        : null)
      if (!roleRecord) continue

      const current = Array.isArray(roleRecord.widgetIdsJson) ? roleRecord.widgetIdsJson : []
      const next = [...current]
      const existing = new Set(current)
      for (const widgetId of resolvedWidgetIds) {
        if (existing.has(widgetId)) continue
        existing.add(widgetId)
        next.push(widgetId)
      }

      if (next.length === current.length) continue
      roleRecord.widgetIdsJson = next
      roleRecord.updatedAt = new Date()
      tem.persist(roleRecord)
      updated = true
    }
  })

  return updated
}
