import type { EntityManager } from '@mikro-orm/postgresql'
import { DashboardRoleWidgets, DashboardUserWidgets } from '../data/entities'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'

type LoadedWidget = {
  metadata: {
    id: string
    features?: string[]
  }
}

type AccessContext = {
  userId: string
  tenantId: string | null
  organizationId: string | null
  features: string[]
  isSuperAdmin: boolean
}

function hasAllFeatures(required: string[] | undefined, ctx: AccessContext): boolean {
  if (!required || required.length === 0) return true
  if (ctx.isSuperAdmin) return true
  const granted = ctx.features || []
  const matchFeature = (req: string, grantedFeature: string) => {
    if (grantedFeature === '*') return true
    if (grantedFeature.endsWith('.*')) {
      const prefix = grantedFeature.slice(0, -2)
      return req === prefix || req.startsWith(prefix + '.')
    }
    return req === grantedFeature
  }
  return required.every((req) => granted.some((g) => matchFeature(req, g)))
}

function specificity(record: DashboardRoleWidgets): number {
  let score = 0
  if (record.tenantId) score += 1
  if (record.organizationId) score += 2
  return score
}

export async function resolveAllowedWidgetIds(
  em: EntityManager,
  ctx: AccessContext,
  widgets: LoadedWidget[],
): Promise<string[]> {
  const allWidgetIds = widgets.map((w) => w.metadata.id)

  // Load user override (if any)
  const userRecord = await em.findOne(DashboardUserWidgets, {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })

  let allowedByUser: Set<string> | null = null
  if (userRecord) {
    if (userRecord.mode === 'override') {
      allowedByUser = new Set(userRecord.widgetIdsJson.filter((id) => allWidgetIds.includes(id)))
    } else {
      allowedByUser = null
    }
  }

  if (allowedByUser && allowedByUser.size === 0) {
    return Array.from(allowedByUser)
  }

  // Aggregate role-level settings
  const userRoles = await em.find(UserRole, { user: ctx.userId as any, deletedAt: null }, { populate: ['role'] })
  const roleRecords = await em.find(DashboardRoleWidgets, {
    roleId: { $in: userRoles.map((ur) => String(ur.role?.id || ur.role)) },
    deletedAt: null,
  })

  const byRole = new Map<string, DashboardRoleWidgets>()
  for (const record of roleRecords) {
    const role = String(record.roleId)
    if (record.tenantId && ctx.tenantId && record.tenantId !== ctx.tenantId) continue
    if (record.tenantId && !ctx.tenantId) continue
    if (record.organizationId && ctx.organizationId && record.organizationId !== ctx.organizationId) continue
    if (record.organizationId && !ctx.organizationId) continue
    const current = byRole.get(role)
    if (!current || specificity(record) > specificity(current)) {
      byRole.set(role, record)
    }
  }

  const allowedByRole = new Set<string>()
  for (const record of byRole.values()) {
    for (const id of record.widgetIdsJson) {
      if (allWidgetIds.includes(id)) allowedByRole.add(id)
    }
  }

  let baseSet: Set<string>
  if (allowedByUser) {
    baseSet = allowedByUser
  } else if (allowedByRole.size > 0) {
    baseSet = allowedByRole
  } else {
    baseSet = new Set(allWidgetIds)
  }

  if (baseSet.size === 0) return []

  const filtered = widgets.filter((widget) => {
    if (!baseSet.has(widget.metadata.id)) return false
    return hasAllFeatures(widget.metadata.features, ctx)
  })

  return filtered.map((widget) => widget.metadata.id)
}
