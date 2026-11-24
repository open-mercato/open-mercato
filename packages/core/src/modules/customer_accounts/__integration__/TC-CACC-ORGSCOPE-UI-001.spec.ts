import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  customerTestPassword,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = {
  dependsOnModules: ['customer_accounts', 'directory'],
}

/**
 * TC-CACC-ORGSCOPE-UI-001 [P1]: browser regression for #5577.
 *
 * Under "All organizations" a staff user opens a customer user of a child organization from the
 * list, sees the child organization roles (not the home organization roles), and a stale first
 * save of a new record is refused with a conflict twice while the typed value is preserved and
 * the record keeps the concurrent change. A save carrying a role of another organization is
 * refused with 400 and leaves the record unchanged.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function scopeCookie(tenantId: string, organizationId: string): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId)}`,
  ].join('; ')
}

async function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

// POST /admin/roles always creates the role in the caller home organization, so a role of
// another organization is seeded directly in the database.
async function createCustomerRoleInDb(input: { tenantId: string; organizationId: string; name: string; slug: string }): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'insert into customer_roles (tenant_id, organization_id, name, slug, is_default, is_system, customer_assignable, created_at, updated_at) values ($1, $2, $3, $4, false, false, false, now(), now()) returning id',
      [input.tenantId, input.organizationId, input.name, input.slug],
    )
    return expectId(result.rows[0]?.id, 'Seeded role should have an id')
  })
}

async function deleteCustomerRoleInDb(roleId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from customer_roles where id = $1', [roleId])
  })
}

async function createCustomerRole(
  request: APIRequestContext,
  token: string,
  cookie: string,
  name: string,
  slug: string,
): Promise<string> {
  const res = await scopedRequest(request, 'POST', '/api/customer_accounts/admin/roles', {
    token,
    cookie,
    data: { name, slug },
  })
  expect(res.status(), `POST /admin/roles (${name}) should return 201`).toBe(201)
  const body = await readJsonSafe<{ role?: { id?: string } }>(res)
  return expectId(body?.role?.id, 'Role creation response should include role.id')
}

test.describe('TC-CACC-ORGSCOPE-UI-001: customer user detail from "All organizations" (#5577)', () => {
  test('opens a child-organization user, offers child roles and refuses a stale first save', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrgId, tenantId } = getTokenContext(adminToken)
    expectId(homeOrgId, 'admin token should carry a home organization')
    expectId(tenantId, 'admin token should carry a tenant')

    const suffix = uniqueSuffix()
    const email = `qa-cacc-orgscope-ui-${suffix}@test.local`
    let childOrgId: string | null = null
    let customerUserId: string | null = null
    let childRoleId: string | null = null
    let homeRoleId: string | null = null

    try {
      childOrgId = await createOrganizationFixture(request, adminToken, {
        name: `QA CACC ORGSCOPE UI CHILD ${suffix}`,
        parentId: homeOrgId,
      })
      const childScope = scopeCookie(tenantId, childOrgId)
      const homeScope = scopeCookie(tenantId, homeOrgId)

      const childRoleName = `QA child buyer ${suffix}`
      const homeRoleName = `QA home buyer ${suffix}`
      childRoleId = await createCustomerRoleInDb({ tenantId, organizationId: childOrgId, name: childRoleName, slug: `qa-child-${suffix}` })
      homeRoleId = await createCustomerRole(request, adminToken, homeScope, homeRoleName, `qa-home-${suffix}`)

      const created = await scopedRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: superadminToken,
        cookie: childScope,
        data: { email, password: customerTestPassword(), displayName: `QA ORGSCOPE UI ${suffix}` },
      })
      expect(created.status(), 'POST /admin/users in the child organization should return 201').toBe(201)
      const createdBody = await readJsonSafe<{ user?: { id?: string } }>(created)
      customerUserId = expectId(createdBody?.user?.id, 'User creation response should include user.id')

      await login(page, 'admin')
      const appUrl = new URL(page.url())
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: tenantId, url: appUrl.origin },
        { name: 'om_selected_org', value: '__all__', url: appUrl.origin },
      ])

      // All organizations -> list -> detail of a child-organization user.
      await page.goto('/backend/customer_accounts/users')
      await page.getByPlaceholder(/search/i).first().fill(email)
      await page.getByText(email, { exact: true }).first().click()
      await expect(page).toHaveURL(new RegExp(`/backend/customer_accounts/users/${customerUserId}$`))

      // Role options come from the edited user's (child) organization.
      await expect(page.getByRole('button', { name: childRoleName, exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: homeRoleName, exact: true })).toHaveCount(0)
      await expect(page.getByText('Failed to load roles.', { exact: true })).toHaveCount(0)

      // Someone else changes the new record after the page loaded.
      const concurrentName = `QA concurrent ${suffix}`
      const concurrent = await scopedRequest(request, 'PUT', `/api/customer_accounts/admin/users/${customerUserId}`, {
        token: adminToken,
        cookie: childScope,
        data: { displayName: concurrentName },
      })
      expect(concurrent.status(), 'concurrent API update should succeed').toBe(200)

      // The stale UI save is refused twice and keeps the typed value.
      const typedName = `QA stale UI ${suffix}`
      const displayName = page.locator('#user-display-name')
      await displayName.fill(typedName)
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const responsePromise = page.waitForResponse((res) =>
          res.url().includes(`/api/customer_accounts/admin/users/${customerUserId}`) && res.request().method() === 'PUT',
        )
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
        const response = await responsePromise
        expect(response.status(), `stale save attempt ${attempt} should be refused`).toBe(409)
        await expect(page.getByText('Record changed').first()).toBeVisible()
        await expect(displayName).toHaveValue(typedName)
      }

      const stored = await scopedRequest(request, 'GET', `/api/customer_accounts/admin/users/${customerUserId}`, {
        token: adminToken,
        cookie: childScope,
      })
      const storedBody = await readJsonSafe<{ displayName?: string }>(stored)
      expect(storedBody?.displayName, 'the concurrent change is kept').toBe(concurrentName)

      // A save carrying a role of another organization is refused and leaves the record intact.
      await page.reload()
      await expect(page.getByRole('button', { name: childRoleName, exact: true })).toBeVisible()
      const beforeInvalid = await readJsonSafe<{ displayName?: string; updatedAt?: string | null; roles?: Array<{ id: string }> }>(
        await scopedRequest(request, 'GET', `/api/customer_accounts/admin/users/${customerUserId}`, { token: adminToken, cookie: childScope }),
      )
      const foreignRoleId = expectId(homeRoleId, 'home role id')
      await page.route(`**/api/customer_accounts/admin/users/${customerUserId}`, async (route) => {
        if (route.request().method() !== 'PUT') return route.continue()
        const body = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>
        await route.continue({ postData: JSON.stringify({ ...body, roleIds: [foreignRoleId] }) })
      })
      const invalidName = `QA invalid role ${suffix}`
      await displayName.fill(invalidName)
      const invalidResponse = page.waitForResponse((res) =>
        res.url().includes(`/api/customer_accounts/admin/users/${customerUserId}`) && res.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
      expect((await invalidResponse).status(), 'a role of another organization is refused').toBe(400)
      await expect(displayName).toHaveValue(invalidName)
      await page.unroute(`**/api/customer_accounts/admin/users/${customerUserId}`)

      const afterInvalid = await readJsonSafe<{ displayName?: string; updatedAt?: string | null; roles?: Array<{ id: string }> }>(
        await scopedRequest(request, 'GET', `/api/customer_accounts/admin/users/${customerUserId}`, { token: adminToken, cookie: childScope }),
      )
      expect(afterInvalid?.displayName, 'display name unchanged after the refused save').toBe(beforeInvalid?.displayName)
      expect(afterInvalid?.updatedAt, 'record version unchanged after the refused save').toBe(beforeInvalid?.updatedAt)
      expect((afterInvalid?.roles ?? []).map((role) => role.id), 'roles unchanged after the refused save')
        .toEqual((beforeInvalid?.roles ?? []).map((role) => role.id))
    } finally {
      if (customerUserId && childOrgId) {
        await scopedRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${customerUserId}`, {
          token: adminToken,
          cookie: scopeCookie(tenantId, childOrgId),
        }).catch(() => undefined)
      }
      if (childRoleId) await deleteCustomerRoleInDb(childRoleId).catch(() => undefined)
      if (homeRoleId) {
        await scopedRequest(request, 'DELETE', `/api/customer_accounts/admin/roles/${homeRoleId}`, {
          token: adminToken,
          cookie: scopeCookie(tenantId, homeOrgId),
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, adminToken, childOrgId)
    }
  })
})
