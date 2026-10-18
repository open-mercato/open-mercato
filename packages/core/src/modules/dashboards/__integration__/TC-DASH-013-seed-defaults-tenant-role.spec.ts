import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const APP_ROOT = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const ROLE_NAMES = ['admin', 'employee', 'superadmin']
const ANALYTICS_WIDGET_ID = 'dashboards.analytics.revenueKpi'

type SetupHook = (input: Record<string, unknown>) => Promise<unknown>

type ModuleLike = {
  id: string
  setup?: {
    onTenantCreated?: SetupHook
    seedDefaults?: SetupHook
  }
}

type TargetAppBootstrap = {
  modules: ModuleLike[]
  entityIds: Record<string, Record<string, string>>
}

type TenantFixture = { tenantId: string; organizationId: string }

type RoleWidgetRow = { roleName: string; roleTenantId: string; widgetIds: string[] }

type RoleWidgetsResponse = { widgetIds?: string[]; hasCustom?: boolean }

let bootstrapPromise: Promise<TargetAppBootstrap> | null = null

async function getDashboardsModule(): Promise<ModuleLike> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const bootstrap = await bootstrapFromAppRoot(APP_ROOT) as TargetAppBootstrap
      const targetRequire = createRequire(path.join(APP_ROOT, 'package.json'))
      const targetEntityIdsPath = targetRequire.resolve('@open-mercato/shared/lib/encryption/entityIds')
      const targetEntityIds = await import(pathToFileURL(targetEntityIdsPath).href) as {
        registerEntityIds: (ids: TargetAppBootstrap['entityIds']) => void
      }
      targetEntityIds.registerEntityIds(bootstrap.entityIds)
      return bootstrap
    })()
  }
  const found = (await bootstrapPromise).modules.find((module) => module.id === 'dashboards')
  expect(found, 'the dashboards module must be registered in this app').toBeTruthy()
  return found!
}

async function createTenantFixture(label: string): Promise<TenantFixture> {
  return withClient(async (client) => {
    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, is_active, created_at, updated_at)
       VALUES ($1, true, now(), now()) RETURNING id`,
      [label],
    )
    const tenantId = tenant.rows[0].id
    const organization = await client.query<{ id: string }>(
      `INSERT INTO organizations (tenant_id, name, is_active, depth, created_at, updated_at)
       VALUES ($1, $2, true, 0, now(), now()) RETURNING id`,
      [tenantId, `${label} org`],
    )
    return { tenantId, organizationId: organization.rows[0].id }
  })
}

async function dropTenantFixture(fixture: TenantFixture | null): Promise<void> {
  if (!fixture) return
  await withClient(async (client) => {
    await client.query('DELETE FROM dashboard_role_widgets WHERE tenant_id = $1', [fixture.tenantId])
    await client.query(
      'DELETE FROM dashboard_role_widgets WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)',
      [fixture.tenantId],
    )
    await client.query(
      'DELETE FROM role_acls WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)',
      [fixture.tenantId],
    )
    await client.query('DELETE FROM roles WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM organizations WHERE tenant_id = $1', [fixture.tenantId])
    await client.query('DELETE FROM tenants WHERE id = $1', [fixture.tenantId])
  })
}

async function readRoleWidgetRows(fixture: TenantFixture): Promise<RoleWidgetRow[]> {
  return withClient(async (client) => {
    const result = await client.query<{ role_name: string; role_tenant_id: string; widget_ids_json: unknown }>(
      `SELECT r.name AS role_name, r.tenant_id::text AS role_tenant_id, w.widget_ids_json
         FROM dashboard_role_widgets w
         JOIN roles r ON r.id = w.role_id
        WHERE w.tenant_id = $1 AND w.organization_id = $2 AND w.deleted_at IS NULL
        ORDER BY r.name`,
      [fixture.tenantId, fixture.organizationId],
    )
    return result.rows.map((row) => {
      const raw = typeof row.widget_ids_json === 'string' ? JSON.parse(row.widget_ids_json) : row.widget_ids_json
      return {
        roleName: row.role_name,
        roleTenantId: row.role_tenant_id,
        widgetIds: Array.isArray(raw) ? raw.map(String) : [],
      }
    })
  })
}

async function readRoleId(fixture: TenantFixture, roleName: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM roles WHERE tenant_id = $1 AND name = $2',
      [fixture.tenantId, roleName],
    )
    return result.rows[0]?.id ?? ''
  })
}

/**
 * TC-DASH-013 — the dashboards tenant-setup hook seeds default widgets onto the new tenant's own
 * roles.
 *
 * Every tenant owns roles named `superadmin`, `admin` and `employee`. The seeding used to look a
 * role up by name alone, so on any instance with more than one tenant it attached the new tenant's
 * default widgets to another tenant's same-named role. The new tenant then had no role-widget rows
 * of its own, and the follow-up `seedDefaults` analytics append skipped it for the same reason.
 *
 * The hooks run in-process against two fresh tenants, as TC-EXAMPLE-010 does, because the full
 * initializer would mask which hook wrote what. Self-contained: both tenants and everything seeded
 * for them are removed in `finally`.
 */
test.describe('TC-DASH-013: dashboards tenant setup seeds widgets onto the tenant\'s own roles', () => {
  test('onTenantCreated and seedDefaults scope role lookups to the new tenant', async ({ request }) => {
    test.slow()
    const dashboardsModule = await getDashboardsModule()
    const onTenantCreated = dashboardsModule.setup?.onTenantCreated
    const seedDefaults = dashboardsModule.setup?.seedDefaults
    expect(onTenantCreated, 'dashboards must declare onTenantCreated').toBeTruthy()
    expect(seedDefaults, 'dashboards must declare seedDefaults').toBeTruthy()

    const suffix = randomUUID().slice(0, 8)
    let first: TenantFixture | null = null
    let second: TenantFixture | null = null

    try {
      first = await createTenantFixture(`TC-DASH-013 first ${suffix}`)
      second = await createTenantFixture(`TC-DASH-013 second ${suffix}`)

      const container = await createRequestContainer()
      const em = container.resolve('em') as EntityManager
      await ensureRoles(em.fork(), { tenantId: first.tenantId })
      await ensureRoles(em.fork(), { tenantId: second.tenantId })

      await onTenantCreated!({ em: em.fork(), tenantId: second.tenantId, organizationId: second.organizationId })

      const seeded = await readRoleWidgetRows(second)
      expect(seeded.map((row) => row.roleName), 'one row per default role of the new tenant').toEqual(ROLE_NAMES)
      for (const row of seeded) {
        expect(row.roleTenantId, `the ${row.roleName} row must reference the new tenant's own role`).toBe(second.tenantId)
      }
      expect(await readRoleWidgetRows(first), 'the other tenant receives nothing').toEqual([])

      await seedDefaults!({ em: em.fork(), tenantId: second.tenantId, organizationId: second.organizationId })

      const employeeRow = (await readRoleWidgetRows(second)).find((row) => row.roleName === 'employee')
      expect(employeeRow?.widgetIds, 'seedDefaults appends analytics widgets to the tenant role').toContain(ANALYTICS_WIDGET_ID)

      const token = await getAuthToken(request, 'superadmin')
      const employeeRoleId = await readRoleId(second, 'employee')
      const query = new URLSearchParams({
        roleId: employeeRoleId,
        tenantId: second.tenantId,
        organizationId: second.organizationId,
      })
      const response = await apiRequest(request, 'GET', `/api/dashboards/roles/widgets?${query.toString()}`, { token })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<RoleWidgetsResponse>(response)
      expect(body?.hasCustom, 'the role-widgets API sees the seeded row').toBe(true)
      expect(body?.widgetIds ?? []).toContain(ANALYTICS_WIDGET_ID)
    } finally {
      await dropTenantFixture(second)
      await dropTenantFixture(first)
    }
  })
})
