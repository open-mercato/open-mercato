import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createOrganizationFixture, createUserFixture, deleteOrganizationIfExists, deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export async function createLedgerBrowserFixture(request: APIRequestContext, baseUrl: string | undefined) {
  if (!baseUrl) throw new Error('[internal] The browser test base URL is required')
  const token = await getAuthToken(request, 'superadmin')
  const stamp = randomUUID()
  const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token, data: { name: `Ledger browser tenant ${stamp}` },
  })
  expect(tenant.status()).toBe(201)
  const tenantId = expectId((await readJsonSafe<{ id: string }>(tenant))?.id, 'Ledger tenant is required')
  let organizationId: string
  try {
    organizationId = await createOrganizationFixture(request, token, { tenantId, name: `Ledger browser organization ${stamp}` })
  } catch (error) {
    await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId)
    throw error
  }
  const userIds: string[] = []
  const scope = { tenantId, organizationId }
  const headers = { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` }
  const cookieUrl = new URL('/', baseUrl).href

  return {
    scope, token, headers,
    async login(page: Page, features: string[]) {
      const actorStamp = randomUUID()
      const email = `ledger-browser-${actorStamp}@example.com`
      const password = `Test-${actorStamp}!`
      const userId = await createUserFixture(request, token, { email, password, organizationId, roles: [] })
      userIds.push(userId)
      const acl = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token, data: { userId, tenantId, organizations: [organizationId], features },
      })
      expect(acl.status()).toBe(200)
      await getAuthToken(page.request, email, password)
      await acknowledgeGlobalNotices(page)
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: tenantId, url: cookieUrl },
        { name: 'om_selected_org', value: organizationId, url: cookieUrl },
      ])
    },
    async cleanup() {
      for (const userId of userIds) await deleteUserIfExists(request, token, userId)
      await deleteOrganizationIfExists(request, token, organizationId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId)
    },
  }
}
