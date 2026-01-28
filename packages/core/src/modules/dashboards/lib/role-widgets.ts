import type { EntityManager } from '@mikro-orm/postgresql'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { DashboardRoleWidgets } from '../data/entities'
import { loadAllWidgets } from './widgets'

type RoleWidgetScope = {
  tenantId: string
  organizationId?: string | null
  roleNames: string[]
  widgetIds: string[]
}

async function findRoleByName(
  em: EntityManager,
  roleName: string,
  tenantId: string,
): Promise<Role | null> {
  const tenantRole = await em.findOne(Role, { name: roleName, tenantId })
  if (tenantRole) return tenantRole
  return em.findOne(Role, { name: roleName, tenantId: null })
}

export async function resolveAnalyticsWidgetIds(): Promise<string[]> {
  const widgets = await loadAllWidgets()
  return widgets
    .filter((widget) => widget.metadata.category === 'analytics' || widget.metadata.id.startsWith('dashboards.analytics.'))
    .map((widget) => widget.metadata.id)
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
