import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { DashboardRoleWidgets } from '../data/entities'
import { dashboardDefaultRoleNames, selectAnalyticsWidgetIds, selectDefaultRoleWidgetIds } from './role-widgets'
import { loadAllWidgets } from './widgets'

type RepairScope = {
  tenantId: string
  organizationId: string | null
  apply: boolean
}

export async function repairDashboardRoleWidgets(em: EntityManager, { tenantId, organizationId, apply }: RepairScope, t: TranslateFn) {
  return em.transactional(async (tx) => {
    if (organizationId) {
      const organizationExists = await tx.count(Organization, { id: organizationId, tenant: tenantId, deletedAt: null })
      if (!organizationExists) throw new Error(t('dashboards.cli.repairRoleWidgets.invalidOrganization'))
    } else {
      const tenantExists = await tx.count(Tenant, { id: tenantId, deletedAt: null })
      if (!tenantExists) throw new Error(t('dashboards.cli.repairRoleWidgets.invalidTenant'))
    }

    const invalid = await tx.execute<Array<{ id: string; localRoleId: string | null; localRoleName: string | null }>>(
      `select assignment.id, local_role.id as "localRoleId", local_role.name as "localRoleName"
       from dashboard_role_widgets as assignment
       join roles as foreign_role
         on foreign_role.id = assignment.role_id and foreign_role.tenant_id <> assignment.tenant_id
       left join roles as local_role
         on local_role.tenant_id = assignment.tenant_id and local_role.name = foreign_role.name
         and local_role.deleted_at is null
       where assignment.tenant_id = ? and assignment.organization_id is not distinct from ?::uuid and assignment.deleted_at is null
       order by assignment.id${apply ? ' for update of assignment' : ''}`,
      [tenantId, organizationId],
    )
    if (!invalid.length) return { removed: 0, restored: 0 }

    const localRoles = new Map(invalid
      .map(({ localRoleId, localRoleName }) => [localRoleName, localRoleId]))

    let widgets: Awaited<ReturnType<typeof loadAllWidgets>> | undefined
    let restored = 0
    for (const roleName of dashboardDefaultRoleNames) {
      const roleId = localRoles.get(roleName)
      if (!roleId) continue

      const existing = await tx.count(DashboardRoleWidgets, {
        roleId,
        deletedAt: null,
        $and: [
          { $or: [{ tenantId }, { tenantId: null }] },
          { $or: [{ organizationId }, { organizationId: null }] },
        ],
      })
      if (existing) continue

      widgets ??= await loadAllWidgets()
      if (!widgets.length) throw new Error(t('dashboards.cli.repairRoleWidgets.unavailableWidgets'))

      const defaults = selectDefaultRoleWidgetIds(widgets, roleName)
      const analytics = roleName === 'superadmin' ? [] : selectAnalyticsWidgetIds(widgets)
      const widgetIdsJson = [...new Set([...defaults, ...analytics])]
      if (!widgetIdsJson.length) continue

      if (apply) {
        const tombstone = await findOneWithDecryption(tx, DashboardRoleWidgets, {
          roleId,
          tenantId,
          organizationId,
          deletedAt: { $ne: null },
        }, { orderBy: { id: 'asc' } }, { tenantId, organizationId })
        if (tombstone) {
          await tx.nativeUpdate(DashboardRoleWidgets, {
            id: tombstone.id,
            tenantId,
            organizationId,
            deletedAt: { $ne: null },
          }, { widgetIdsJson, deletedAt: null, updatedAt: new Date() })
        } else {
          tx.persist(tx.create(DashboardRoleWidgets, {
            roleId,
            tenantId,
            organizationId,
            widgetIdsJson,
            createdAt: new Date(),
          }))
        }
      }
      restored += 1
    }

    const removed = apply
      ? await tx.nativeDelete(DashboardRoleWidgets, {
        id: { $in: invalid.map(({ id }) => id) },
        tenantId,
        organizationId,
        deletedAt: null,
      })
      : invalid.length
    return { removed, restored }
  }, { readOnly: !apply })
}
