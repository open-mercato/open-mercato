import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

type CreateResponse = { id?: string }

async function apiRequestWithCookie(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

function scopeCookie(tenantId: string, organizationId: string | null): string {
  const parts = [`om_selected_tenant=${encodeURIComponent(tenantId)}`]
  parts.push(`om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`)
  return parts.join('; ')
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name },
  })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<CreateResponse>(response)
  return expectId(body?.id, 'Tenant create response should contain an id')
}

async function createOrganization(
  request: APIRequestContext,
  token: string,
  cookie: string,
  tenantId: string,
  name: string,
): Promise<string> {
  const response = await apiRequestWithCookie(request, 'POST', '/api/directory/organizations', {
    token,
    cookie,
    data: { name, tenantId },
  })
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201)
  const body = await readJsonSafe<CreateResponse>(response)
  return expectId(body?.id, 'Organization create response should contain an id')
}

async function createUser(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  email: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/auth/users', {
    token,
    data: {
      email,
      password: 'StrongSecret123!',
      organizationId,
    },
  })
  expect(response.status(), 'POST /api/auth/users should return 201').toBe(201)
  const body = await readJsonSafe<CreateResponse>(response)
  return expectId(body?.id, 'User create response should contain an id')
}

/**
 * TC-AUTH-041: Superadmin users list respects selected tenant and organization context.
 * Covers: GET /api/auth/users, /backend/users
 */
test.describe('TC-AUTH-041: Superadmin users list context scope', () => {
  test('scopes /backend/users to selected organization and all organizations within selected tenant', async ({ page, request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId: actorTenantId, organizationId: actorOrganizationId } = getTokenContext(token)
    const actorCookie = scopeCookie(actorTenantId, actorOrganizationId || null)
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'

    let targetTenantId: string | null = null
    let otherTenantId: string | null = null
    let targetOrganizationId: string | null = null
    let siblingOrganizationId: string | null = null
    let otherOrganizationId: string | null = null
    let targetUserId: string | null = null
    let siblingUserId: string | null = null
    let otherUserId: string | null = null

    const targetEmail = `qa-auth-041-target-${stamp}@example.com`
    const siblingEmail = `qa-auth-041-sibling-${stamp}@example.com`
    const otherEmail = `qa-auth-041-other-${stamp}@example.com`

    try {
      targetTenantId = await createTenant(request, token, `QA AUTH 041 Target Tenant ${stamp}`)
      otherTenantId = await createTenant(request, token, `QA AUTH 041 Other Tenant ${stamp}`)
      targetOrganizationId = await createOrganization(
        request,
        token,
        actorCookie,
        targetTenantId,
        `QA AUTH 041 Target Org ${stamp}`,
      )
      siblingOrganizationId = await createOrganization(
        request,
        token,
        actorCookie,
        targetTenantId,
        `QA AUTH 041 Sibling Org ${stamp}`,
      )
      otherOrganizationId = await createOrganization(
        request,
        token,
        actorCookie,
        otherTenantId,
        `QA AUTH 041 Other Org ${stamp}`,
      )

      targetUserId = await createUser(request, token, targetOrganizationId, targetEmail)
      siblingUserId = await createUser(request, token, siblingOrganizationId, siblingEmail)
      otherUserId = await createUser(request, token, otherOrganizationId, otherEmail)

      await login(page, 'superadmin')
      await page.context().addCookies([
        {
          name: 'om_selected_tenant',
          value: targetTenantId,
          url: baseUrl,
          sameSite: 'Lax',
        },
        {
          name: 'om_selected_org',
          value: targetOrganizationId,
          url: baseUrl,
          sameSite: 'Lax',
        },
      ])
      await page.goto('/backend/users', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
      await expect(page.getByText(targetEmail)).toBeVisible()
      await expect(page.getByText(siblingEmail)).toHaveCount(0)
      await expect(page.getByText(otherEmail)).toHaveCount(0)

      await page.context().addCookies([
        {
          name: 'om_selected_tenant',
          value: targetTenantId,
          url: baseUrl,
          sameSite: 'Lax',
        },
        {
          name: 'om_selected_org',
          value: '__all__',
          url: baseUrl,
          sameSite: 'Lax',
        },
      ])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(targetEmail)).toBeVisible()
      await expect(page.getByText(siblingEmail)).toBeVisible()
      await expect(page.getByText(otherEmail)).toHaveCount(0)
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/auth/users', targetUserId)
      await deleteGeneralEntityIfExists(request, token, '/api/auth/users', siblingUserId)
      await deleteGeneralEntityIfExists(request, token, '/api/auth/users', otherUserId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', targetOrganizationId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', siblingOrganizationId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', otherOrganizationId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', targetTenantId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', otherTenantId)
    }
  })
})
