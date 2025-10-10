import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
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

    const widgets = await loadAllWidgets()
    const widgetMap = new Map(widgets.map((widget) => [widget.metadata.id, widget]))
    const widgetIds = widgetCsv
      ? widgetCsv.split(',').map((id) => id.trim()).filter((id) => widgetMap.has(id))
      : widgets.filter((w) => w.metadata.defaultEnabled).map((w) => w.metadata.id)

    if (!widgetIds.length) {
      console.error('No valid widget IDs to assign.')
      return
    }

    await em.transactional(async (tem: any) => {
      for (const name of roleNames) {
        const role = await tem.findOne(Role, { name })
        if (!role) {
          console.warn(`Skipping role "${name}" (not found)`)
          continue
        }
        const existing = await tem.findOne(DashboardRoleWidgets, {
          roleId: String(role.id),
          tenantId,
          organizationId,
          deletedAt: null,
        })
        if (existing) {
          existing.widgetIdsJson = widgetIds
          tem.persist(existing)
          console.log(`Updated dashboard widgets for role "${name}"`)
        } else {
          const record = tem.create(DashboardRoleWidgets, {
            roleId: String(role.id),
            tenantId,
            organizationId,
            widgetIdsJson: widgetIds,
          })
          tem.persist(record)
          console.log(`Created dashboard widgets for role "${name}"`)
        }
      }
    })
  },
}

export default [seedDefaults]
