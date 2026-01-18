import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DashboardRoleWidgets } from '@open-mercato/core/modules/dashboards/data/entities'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { loadAllWidgets } from '@open-mercato/core/modules/dashboards/lib/widgets'

type Args = Record<string, string>

function parseArgs(rest: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '')
    const value = rest[i + 1]
    if (key) args[key] = value ?? ''
  }
  return args
}

export async function seedDashboardDefaultsForTenant(
  em: EntityManager,
  {
    tenantId,
    organizationId = null,
    roleNames = ['superadmin', 'admin', 'employee'],
    widgetIds,
    logger,
  }: {
    tenantId: string
    organizationId?: string | null
    roleNames?: string[]
    widgetIds?: string[]
    logger?: (message: string) => void
  },
): Promise<boolean> {
  if (!tenantId) throw new Error('tenantId is required')
  const log = logger ?? (() => {})

  const widgets = await loadAllWidgets()
  const widgetMap = new Map(widgets.map((widget) => [widget.metadata.id, widget]))
  const resolvedWidgetIds = widgetIds && widgetIds.length
    ? widgetIds.filter((id) => widgetMap.has(id))
    : widgets.filter((widget) => widget.metadata.defaultEnabled).map((widget) => widget.metadata.id)

  if (!resolvedWidgetIds.length) {
    log('No widgets resolved for dashboard seeding.')
    return false
  }

  await em.transactional(async (tem) => {
    for (const roleName of roleNames) {
      const role = await tem.findOne(Role, { name: roleName })
      if (!role) {
        log(`Skipping role "${roleName}" (not found)`)
        continue
      }
      const existing = await tem.findOne(DashboardRoleWidgets, {
        roleId: String(role.id),
        tenantId,
        organizationId,
        deletedAt: null,
      })
      if (existing) {
        existing.widgetIdsJson = resolvedWidgetIds
        tem.persist(existing)
        log(`Updated dashboard widgets for role "${roleName}"`)
      } else {
        const record = tem.create(DashboardRoleWidgets, {
          roleId: String(role.id),
          tenantId,
          organizationId,
          widgetIdsJson: resolvedWidgetIds,
          createdAt: new Date(),
          updatedAt: null,
          deletedAt: null,
        })
        tem.persist(record)
        log(`Created dashboard widgets for role "${roleName}"`)
      }
    }
  })

  return true
}

const seedDefaults: ModuleCli = {
  command: 'seed-defaults',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = args.tenant || args.tenantId || null
    const organizationId = args.organization || args.organizationId || null
    const roleCsv = args.roles || 'superadmin,admin,employee'
    const widgetCsv = args.widgets || ''
    if (!tenantId) {
      console.error('Usage: mercato dashboards seed-defaults --tenant <tenantId> [--roles superadmin,admin,employee] [--widgets id1,id2]')
      return
    }

    const roleNames = roleCsv
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)

    if (!roleNames.length) {
      console.log('No roles provided, nothing to seed.')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    await seedDashboardDefaultsForTenant(em as EntityManager, {
      tenantId,
      organizationId,
      roleNames,
      widgetIds: widgetCsv ? widgetCsv.split(',').map((id) => id.trim()).filter(Boolean) : undefined,
      logger: (message) => console.log(message),
    })
  },
}

export default [seedDefaults]
