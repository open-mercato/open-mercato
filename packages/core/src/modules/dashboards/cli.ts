import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DashboardRoleWidgets } from '@open-mercato/core/modules/dashboards/data/entities'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { loadAllWidgets } from '@open-mercato/core/modules/dashboards/lib/widgets'
import { seedAnalyticsData } from './seed/analytics'

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

const seedAnalytics: ModuleCli = {
  command: 'seed-analytics',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = args.tenant || args.tenantId || null
    const organizationId = args.organization || args.organizationId || args.org || null
    const months = args.months ? parseInt(args.months, 10) : 6
    const ordersPerMonth = args.ordersPerMonth ? parseInt(args.ordersPerMonth, 10) : 50

    if (!tenantId || !organizationId) {
      console.error('Usage: mercato dashboards seed-analytics --tenant <tenantId> --organization <organizationId> [--months 6] [--ordersPerMonth 50]')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager

    console.log(`Seeding analytics data for ${months} months with ~${ordersPerMonth} orders/month...`)

    try {
      const result = await em.transactional(async (tem) =>
        seedAnalyticsData(tem, { tenantId, organizationId }, { months, ordersPerMonth })
      )

      if (result.orders === 0) {
        console.log('Analytics data already exists. Skipping seed.')
      } else {
        console.log(`Seeded analytics data:`)
        console.log(`  - Orders: ${result.orders}`)
        console.log(`  - Customers: ${result.customers}`)
        console.log(`  - Products: ${result.products}`)
        console.log(`  - Deals: ${result.deals}`)
      }
    } catch (error) {
      console.error('Failed to seed analytics data:', error)
    }
  },
}

const debugAnalytics: ModuleCli = {
  command: 'debug-analytics',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = args.tenant || args.tenantId || null
    const organizationId = args.organization || args.organizationId || args.org || null

    if (!tenantId) {
      console.error('Usage: mercato dashboards debug-analytics --tenant <tenantId> [--organization <organizationId>]')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager
    const conn = em.getConnection()

    console.log('Checking analytics data...\n')

    const ordersResult = await conn.execute(
      `SELECT COUNT(*) as total, MIN(placed_at) as earliest, MAX(placed_at) as latest
       FROM sales_orders
       WHERE tenant_id = ? AND order_number LIKE 'SO-ANALYTICS-%'`,
      [tenantId]
    )
    console.log('Orders summary:', ordersResult[0])

    const recentOrders = await conn.execute(
      `SELECT order_number, placed_at, status, grand_total_gross_amount::numeric as total
       FROM sales_orders
       WHERE tenant_id = ? AND order_number LIKE 'SO-ANALYTICS-%'
       ORDER BY placed_at DESC LIMIT 5`,
      [tenantId]
    )
    console.log('\nRecent orders:', recentOrders)

    const januaryOrders = await conn.execute(
      `SELECT COUNT(*) as count, SUM(grand_total_gross_amount::numeric) as total
       FROM sales_orders
       WHERE tenant_id = ?
         AND order_number LIKE 'SO-ANALYTICS-%'
         AND placed_at >= '2026-01-01'
         AND placed_at <= '2026-01-31 23:59:59'`,
      [tenantId]
    )
    console.log('\nJanuary 2026 orders:', januaryOrders[0])

    const allOrders = await conn.execute(
      `SELECT COUNT(*) as count
       FROM sales_orders
       WHERE tenant_id = ?`,
      [tenantId]
    )
    console.log('\nTotal orders in tenant:', allOrders[0])

    const orgCheck = await conn.execute(
      `SELECT organization_id, COUNT(*) as count
       FROM sales_orders
       WHERE tenant_id = ? AND order_number LIKE 'SO-ANALYTICS-%'
       GROUP BY organization_id`,
      [tenantId]
    )
    console.log('\nOrders by organization:', orgCheck)

    if (organizationId) {
      const orgOrders = await conn.execute(
        `SELECT COUNT(*) as count, SUM(grand_total_gross_amount::numeric) as total
         FROM sales_orders
         WHERE tenant_id = ?
           AND organization_id = ?
           AND placed_at >= '2026-01-01'
           AND placed_at <= '2026-01-31 23:59:59'`,
        [tenantId, organizationId]
      )
      console.log(`\nJanuary orders for org ${organizationId}:`, orgOrders[0])
    }

    // Check for NULL placed_at
    const nullPlacedAt = await conn.execute(
      `SELECT COUNT(*) as count
       FROM sales_orders
       WHERE tenant_id = ? AND placed_at IS NULL`,
      [tenantId]
    )
    console.log('\nOrders with NULL placed_at:', nullPlacedAt[0])

    // Check non-analytics orders
    const nonAnalytics = await conn.execute(
      `SELECT order_number, placed_at, status, organization_id, grand_total_gross_amount::numeric as total
       FROM sales_orders
       WHERE tenant_id = ? AND order_number NOT LIKE 'SO-ANALYTICS-%'
       ORDER BY placed_at DESC NULLS LAST LIMIT 10`,
      [tenantId]
    )
    console.log('\nNon-analytics orders:', nonAnalytics)

    // Simulate widget query
    console.log('\n--- Simulating widget query for this_month ---')
    const widgetQuery = await conn.execute(
      `SELECT COALESCE(SUM(grand_total_gross_amount::numeric), 0) AS value
       FROM sales_orders
       WHERE tenant_id = ?
         AND organization_id = ANY(?::uuid[])
         AND deleted_at IS NULL
         AND placed_at >= '2026-01-01'
         AND placed_at <= '2026-01-31 23:59:59'`,
      [tenantId, `{${organizationId}}`]
    )
    console.log('Widget query result (revenue sum):', widgetQuery[0])

    const widgetCountQuery = await conn.execute(
      `SELECT COUNT(*) AS value
       FROM sales_orders
       WHERE tenant_id = ?
         AND organization_id = ANY(?::uuid[])
         AND deleted_at IS NULL
         AND placed_at >= '2026-01-01'
         AND placed_at <= '2026-01-31 23:59:59'`,
      [tenantId, `{${organizationId}}`]
    )
    console.log('Widget query result (order count):', widgetCountQuery[0])
  },
}

export default [seedDefaults, seedAnalytics, debugAnalytics]
