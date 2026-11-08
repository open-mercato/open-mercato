import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
  setCustomerRoleAcl,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type PortalProfile = { roles: Array<{ id: string }>; resolvedFeatures: string[] }

async function expectProfileFeatures(
  request: APIRequestContext,
  cookie: string,
  roleId: string,
  granted: string,
  removed: string,
) {
  const response = await request.get('/api/customer_accounts/portal/profile', { headers: { Cookie: cookie } })
  expect(response.status()).toBe(200)
  const profile = await readJsonSafe<PortalProfile>(response)
  expect(profile?.roles.map((role) => role.id)).toEqual([roleId])
  expect(profile?.resolvedFeatures).toContain(granted)
  expect(profile?.resolvedFeatures).not.toContain(removed)
}

for (const writer of ['staff', 'portal'] as const) {
  test(`TC-CACC-ROLE-CACHE-001: ${writer} role reassignment invalidates an already signed-in portal ACL`, async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(admin)
    const roleIds: string[] = []
    const userIds: string[] = []
    let companyId: string | null = null
    try {
      const first = await createCustomerRoleFixture(request, admin, {
        features: ['portal.account.view'], customerAssignable: true,
      })
      roleIds.push(first.id)
      const second = await createCustomerRoleFixture(request, admin, {
        features: ['portal.account.manage'], customerAssignable: true,
      })
      roleIds.push(second.id)
      if (writer === 'portal') companyId = await createCustomerCompanyFixture(request, admin)
      const target = await createCustomerUserFixture(request, admin, {
        roleIds: [first.id], customerEntityId: companyId,
      })
      userIds.push(target.id)
      const targetSession = await portalLogin(request, { email: target.email, password: target.password, tenantId })
      await expectProfileFeatures(request, targetSession.cookieHeader, first.id, 'portal.account.view', 'portal.account.manage')

      if (writer === 'staff') {
        const changed = await apiRequest(request, 'PUT', `/api/customer_accounts/admin/users/${target.id}`, {
          token: admin, data: { roleIds: [second.id] },
        })
        expect(changed.status()).toBe(200)
      } else {
        const managerRole = await createCustomerRoleFixture(request, admin, { features: ['portal.users.roles.manage'] })
        roleIds.push(managerRole.id)
        const manager = await createCustomerUserFixture(request, admin, {
          roleIds: [managerRole.id], customerEntityId: companyId,
        })
        userIds.push(manager.id)
        const managerSession = await portalLogin(request, { email: manager.email, password: manager.password, tenantId })
        const changed = await request.put(`/api/customer_accounts/portal/users/${target.id}/roles`, {
          headers: portalCookieHeaders(managerSession), data: { roleIds: [second.id] },
        })
        expect(changed.status()).toBe(200)
      }

      await expectProfileFeatures(request, targetSession.cookieHeader, second.id, 'portal.account.manage', 'portal.account.view')
      await setCustomerRoleAcl(request, admin, second.id, { features: ['portal.orders.view'] })
      await expectProfileFeatures(request, targetSession.cookieHeader, second.id, 'portal.orders.view', 'portal.account.manage')
    } finally {
      for (const userId of userIds) {
        await apiRequest(request, 'PUT', `/api/customer_accounts/admin/users/${userId}`, {
          token: admin, data: { roleIds: [] },
        })
        await deleteCustomerUserFixture(request, admin, userId)
      }
      for (const roleId of roleIds) await deleteCustomerRoleFixture(request, admin, roleId)
      await deleteCustomerCompanyFixture(request, admin, companyId)
    }
  })
}
