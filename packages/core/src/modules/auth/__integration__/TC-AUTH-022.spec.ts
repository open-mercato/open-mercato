import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type RoleAclResponse = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

type OrganizationListResponse = {
  items?: Array<{ id?: string | null; tenantId?: string | null }>
}

function decodeJwtClaims(token: string): { tenantId?: string; orgId?: string | null } | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { tenantId?: string; orgId?: string | null }
  } catch {
    return null
  }
}

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)

  const response = await page.request.post('/api/auth/login', {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    data: form.toString(),
  })
  expect(response.ok()).toBeTruthy()

  const body = (await response.json().catch(() => null)) as { token?: string } | null
  const claims = typeof body?.token === 'string' ? decodeJwtClaims(body.token) : null
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const cookies = []

  if (claims?.tenantId) {
    cookies.push({
      name: 'om_selected_tenant',
      value: claims.tenantId,
      url: baseUrl,
      sameSite: 'Lax' as const,
    })
  }
  if (claims?.orgId) {
    cookies.push({
      name: 'om_selected_org',
      value: claims.orgId,
      url: baseUrl,
      sameSite: 'Lax' as const,
    })
  }
  if (cookies.length > 0) {
    await page.context().addCookies(cookies)
  }

  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/backend(?:\/.*)?$/, { timeout: 15_000 })
}

async function getRoleAcl(request: APIRequestContext, token: string, roleId: string): Promise<RoleAclResponse> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId)}`, { token })
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as Partial<RoleAclResponse>
  return {
    isSuperAdmin: !!body.isSuperAdmin,
    features: Array.isArray(body.features) ? body.features : [],
    organizations: Array.isArray(body.organizations) ? body.organizations : null,
  }
}

async function setRoleAcl(
  request: APIRequestContext,
  token: string,
  payload: { roleId: string; isSuperAdmin: boolean; features: string[]; organizations: string[] | null },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token,
    data: payload,
  })
  expect(response.ok()).toBeTruthy()
}

test.describe('TC-AUTH-022: customer_accounts wildcard shows customer portal sidebar section', () => {
  test('shows customer portal settings links when the role grants customer_accounts.*', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const roleName = `qa-customer-portal-wildcard-${Date.now()}`
    const userEmail = `${roleName}@example.com`
    const userPassword = 'StrongSecret123!'
    let roleId: string | null = null
    let userId: string | null = null
    let originalRoleAcl: RoleAclResponse | null = null

    try {
      const organizationsResponse = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', {
        token: superadminToken,
      })
      expect(organizationsResponse.ok()).toBeTruthy()
      const organizationsBody = (await organizationsResponse.json()) as OrganizationListResponse
      const organization = (organizationsBody.items ?? []).find(
        (item) => typeof item.id === 'string' && item.id.length > 0,
      )
      expect(organization?.id).toBeTruthy()
      const organizationId = organization!.id as string
      const tenantId = organization?.tenantId ?? null

      const createRoleResponse = await apiRequest(request, 'POST', '/api/auth/roles', {
        token: superadminToken,
        data: { name: roleName, tenantId },
      })
      expect(createRoleResponse.ok()).toBeTruthy()
      const createRoleBody = (await createRoleResponse.json()) as { id?: string }
      roleId = typeof createRoleBody.id === 'string' ? createRoleBody.id : null
      expect(roleId).toBeTruthy()

      originalRoleAcl = await getRoleAcl(request, superadminToken, roleId!)
      await setRoleAcl(request, superadminToken, {
        roleId: roleId!,
        isSuperAdmin: false,
        features: ['customer_accounts.*'],
        organizations: null,
      })

      const createUserResponse = await apiRequest(request, 'POST', '/api/auth/users', {
        token: superadminToken,
        data: {
          email: userEmail,
          password: userPassword,
          organizationId,
          roles: [roleName],
        },
      })
      expect(createUserResponse.ok()).toBeTruthy()
      const createUserBody = (await createUserResponse.json()) as { id?: string }
      userId = typeof createUserBody.id === 'string' ? createUserBody.id : null
      expect(userId).toBeTruthy()

      await loginWithCredentials(page, userEmail, userPassword)
      await page.goto('/backend/customer_accounts/users', { waitUntil: 'domcontentloaded' })

      await expect(page.locator('a[href="/backend/customer_accounts/users"]').first()).toBeVisible()
      await expect(page.locator('a[href="/backend/customer_accounts/roles"]').first()).toBeVisible()
    } finally {
      if (userId) {
        await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, {
          token: superadminToken,
        }).catch(() => {})
      }
      if (roleId && originalRoleAcl) {
        await setRoleAcl(request, superadminToken, {
          roleId,
          isSuperAdmin: originalRoleAcl.isSuperAdmin,
          features: originalRoleAcl.features,
          organizations: originalRoleAcl.organizations,
        }).catch(() => {})
      }
      if (roleId) {
        await apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, {
          token: superadminToken,
        }).catch(() => {})
      }
    }
  })
})
