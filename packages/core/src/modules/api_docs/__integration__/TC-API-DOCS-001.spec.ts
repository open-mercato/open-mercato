import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test as base, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'

const runFile = promisify(execFile)
const password = 'DocsRegression1!'
type ActorOptions = { features: string[]; superadmin?: boolean; organizations?: string[]; organizationId?: string }
type DocsFixture = {
  tenantId: string
  organizationId: string
  otherOrganizationId: string
  actor: (options: ActorOptions) => Promise<string>
  adminRoleId: string
  adminActor: () => Promise<string>
}

const test = base.extend<{ docs: DocsFixture }>({
  docs: async ({ request }, use) => {
    const tenantId = randomUUID()
    const adminRoleId = randomUUID()
    const bootstrapToken = await getAuthToken(request, 'superadmin')
    try {
      await withClient(async (client) => {
        await client.query('insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())', [tenantId, `docs-${tenantId}`])
        await client.query('insert into roles (id, name, tenant_id, created_at, updated_at) values ($1, $2, $3, now(), now())', [adminRoleId, 'admin', tenantId])
        await client.query('insert into roles (id, name, tenant_id, created_at, updated_at) values ($1, $2, $3, now(), now())', [randomUUID(), 'employee', tenantId])
      })
      const organizationId = await createOrganizationFixture(request, bootstrapToken, { name: `docs-home-${tenantId}`, tenantId })
      const otherOrganizationId = await createOrganizationFixture(request, bootstrapToken, { name: `docs-other-${tenantId}`, tenantId })
      const createActor = async (roleNames: string[], homeOrganizationId: string): Promise<string> => {
        const email = `docs-${randomUUID()}@example.com`
        const response = await apiRequest(request, 'POST', '/api/auth/users', {
          token: bootstrapToken,
          headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${homeOrganizationId}` },
          data: { email, password, organizationId: homeOrganizationId, roles: roleNames },
        })
        expect(response.status(), await response.text()).toBe(201)
        return getAuthToken(request, email, password)
      }
      const actor = async (options: ActorOptions): Promise<string> => {
        const roleId = randomUUID()
        const roleName = `docs-${roleId}`
        await withClient(async (client) => {
          await client.query('insert into roles (id, name, tenant_id, created_at, updated_at) values ($1, $2, $3, now(), now())', [roleId, roleName, tenantId])
          await client.query('insert into role_acls (id, role_id, tenant_id, features_json, is_super_admin, organizations_json, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, now(), now())', [randomUUID(), roleId, tenantId, JSON.stringify(options.features), options.superadmin ?? false, options.organizations ? JSON.stringify(options.organizations) : null])
        })
        const roleNames = [roleName]
        if (options.organizationId && options.organizations) {
          const visibilityRoleId = randomUUID()
          const visibilityRoleName = `docs-visible-${visibilityRoleId}`
          await withClient(async (client) => {
            await client.query('insert into roles (id, name, tenant_id, created_at, updated_at) values ($1, $2, $3, now(), now())', [visibilityRoleId, visibilityRoleName, tenantId])
            await client.query('insert into role_acls (id, role_id, tenant_id, features_json, is_super_admin, organizations_json, created_at, updated_at) values ($1, $2, $3, $4, false, $5, now(), now())', [randomUUID(), visibilityRoleId, tenantId, JSON.stringify(['customers.view']), JSON.stringify([options.organizationId])])
          })
          roleNames.push(visibilityRoleName)
        }
        return createActor(roleNames, options.organizationId ?? organizationId)
      }
      await use({ tenantId, organizationId, otherOrganizationId, actor, adminRoleId, adminActor: () => createActor(['admin'], organizationId) })
    } finally {
      await withClient(async (client) => {
        await client.query('delete from sessions where user_id in (select id from users where tenant_id = $1)', [tenantId])
        await client.query('update users set deleted_at = now() where tenant_id = $1', [tenantId])
        await client.query('update role_acls set deleted_at = now() where tenant_id = $1', [tenantId])
        await client.query('update roles set deleted_at = now() where tenant_id = $1', [tenantId])
        await client.query('update organizations set deleted_at = now() where tenant_id = $1', [tenantId])
        await client.query('update tenants set deleted_at = now() where id = $1', [tenantId])
      })
    }
  },
})

async function navigationHasDocs(request: APIRequestContext, token: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', '/api/auth/admin/nav', { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<unknown>(response)
  const hasDocs = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some(hasDocs)
    const record = value as Record<string, unknown>
    return record.href === '/backend/docs' || Object.values(record).some(hasDocs)
  }
  return hasDocs(body)
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`backend documentation at ${viewport.width}px`, () => {
    for (const features of [['api_docs.view'], ['api_docs.*'], ['*'], [], ['customers.*']]) {
      test(`enforces page and navigation access for ${features.join(',') || 'no grants'}`, async ({ page, request, docs, baseURL }) => {
        const token = await docs.actor({ features })
        const allowed = features[0] === 'api_docs.view' || features[0] === 'api_docs.*' || features[0] === '*'
        await page.setViewportSize(viewport)
        await page.context().addCookies([{ name: 'auth_token', value: token, url: baseURL! }])
        await page.goto('/backend/docs', { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('heading', { name: 'API resources', exact: true })).toHaveCount(allowed ? 1 : 0)
        if (!allowed) await expect(page.getByText('Access Denied', { exact: true })).toBeVisible()
        expect(new URL(page.url()).pathname).toBe('/backend/docs')
        expect(await navigationHasDocs(request, token)).toBe(allowed)
        if (viewport.width < 1024) {
          const closeMenu = page.getByRole('button', { name: 'Close menu', exact: true })
          await expect.poll(async () => {
            if (await closeMenu.isVisible()) return true
            await page.getByRole('button', { name: 'Open menu', exact: true }).click()
            return closeMenu.isVisible()
          }).toBe(true)
        }
        const docsLink = page.getByRole('link', { name: 'API documentation', exact: true })
        if (allowed) await expect(docsLink).toBeVisible()
        else await expect(docsLink).toHaveCount(0)
      })
    }
  })
}

test('preserves real superadmin access without stored documentation grants', async ({ page, request, docs, baseURL }) => {
  const token = await docs.actor({ features: [], superadmin: true })
  await page.context().addCookies([{ name: 'auth_token', value: token, url: baseURL! }])
  await page.goto('/backend/docs', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'API resources', exact: true })).toBeVisible()
  expect(await navigationHasDocs(request, token)).toBe(true)
})

test('denies documentation outside the grant organization despite visibility in both organizations', async ({ page, request, docs, baseURL }) => {
  const token = await docs.actor({ features: ['api_docs.view'], organizations: [docs.organizationId], organizationId: docs.otherOrganizationId })
  await page.context().addCookies([{ name: 'auth_token', value: token, url: baseURL! }])
  await page.goto('/backend/docs', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Access Denied', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'API resources', exact: true })).toHaveCount(0)
  expect(await navigationHasDocs(request, token)).toBe(false)
})

for (const existingAcl of [false, true]) {
  test(`${existingAcl ? 'synchronizes existing' : 'provisions new'} default admin documentation grants`, async ({ docs, page, baseURL, request }) => {
    if (existingAcl) {
      await withClient(async (client) => {
        await client.query('insert into role_acls (id, role_id, tenant_id, features_json, is_super_admin, created_at, updated_at) values ($1, $2, $3, $4, false, now(), now())', [randomUUID(), docs.adminRoleId, docs.tenantId, JSON.stringify(['customers.view'])])
      })
    }
    const { stdout } = await runFile('yarn', ['mercato', 'auth', 'sync-role-acls', '--tenant', docs.tenantId], {
      cwd: process.env.OM_TEST_APP_ROOT?.trim() || process.cwd(),
      env: { ...process.env, OM_APP_ROOT: resolveAppRoot() },
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    expect(stdout).toContain(`Synced role ACLs for tenant ${docs.tenantId}`)
    await withClient(async (client) => {
      const result = await client.query<{ name: string; features_json: string[] }>('select role.name, acl.features_json from role_acls acl join roles role on role.id = acl.role_id where role.tenant_id = $1 and acl.tenant_id = $1 and acl.deleted_at is null', [docs.tenantId])
      const adminFeatures = result.rows.find((role) => role.name === 'admin')?.features_json ?? []
      expect(adminFeatures).toContain('api_docs.view')
      if (existingAcl) expect(adminFeatures).toContain('customers.view')
      const employee = result.rows.find((role) => role.name === 'employee')
      expect(employee).toBeDefined()
      expect(employee?.features_json).not.toContain('api_docs.view')
    })
    const token = await docs.adminActor()
    await page.context().addCookies([{ name: 'auth_token', value: token, url: baseURL! }])
    await page.goto('/backend/docs', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'API resources', exact: true })).toBeVisible()
    expect(await navigationHasDocs(request, token)).toBe(true)
  })
}

test('keeps the public Explorer and exports accessible anonymously', async ({ request }) => {
  for (const path of ['/docs/api', '/api/docs/openapi', '/api/docs/markdown']) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(200)
    if (path === '/api/docs/openapi') {
      const document = await readJsonSafe<{ paths: Record<string, unknown> }>(response)
      expect(Object.keys(document?.paths ?? {}).length).toBeGreaterThan(0)
    } else {
      expect((await response.text()).length).toBeGreaterThan(0)
    }
  }
})

test('requires authentication for direct backend documentation access', async ({ page }) => {
  await page.goto('/backend/docs', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'API resources', exact: true })).toHaveCount(0)
})
