import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['directory', 'auth', 'customers'],
}

test('TC-DIR-023: feature narrowing preserves invalid organization refusals on reads and writes', async ({ request }) => {
  const administratorToken = await getAuthToken(request, 'superadmin')
  const tenantId = expectId(getTokenContext(administratorToken).tenantId, 'Tenant context is required')
  const fixtureId = randomUUID()
  const email = `qa-dir-023-${fixtureId}@example.com`
  const password = `Test-${fixtureId}!`
  const companyIds: string[] = []
  let organizationId: string | null = null
  let otherOrganizationId: string | null = null
  let userId: string | null = null

  try {
    organizationId = await createOrganizationFixture(request, administratorToken, {
      name: `TC-DIR-023 Allowed ${fixtureId}`,
      tenantId,
    })
    otherOrganizationId = await createOrganizationFixture(request, administratorToken, {
      name: `TC-DIR-023 Inaccessible ${fixtureId}`,
      tenantId,
    })
    userId = await createUserFixture(request, administratorToken, {
      email,
      password,
      organizationId,
      roles: [],
    })
    await setUserAclVisibility(request, administratorToken, {
      userId,
      organizations: [organizationId],
      features: ['customers.companies.view', 'customers.companies.manage'],
    })
    const token = await getAuthToken(request, email, password)

    for (const rejectedOrganizationId of [otherOrganizationId, randomUUID(), 'all']) {
      const listResponse = await apiRequestWithSelectedOrg(request, 'GET', '/api/customers/companies?pageSize=1', {
        token,
        selectedOrgId: rejectedOrganizationId,
      })
      expect(listResponse.status()).toBe(422)
      expect(await readJsonSafe(listResponse)).toMatchObject({ code: 'organization_selection_invalid' })
      expect(listResponse.headers()['set-cookie']).toContain('om_selected_org=;')

      const createResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/companies', {
        token,
        selectedOrgId: rejectedOrganizationId,
        data: { displayName: `TC-DIR-023 Rejected ${randomUUID()}` },
      })
      const body = await readJsonSafe<{ id?: string; code?: string }>(createResponse)
      if (body?.id) companyIds.push(body.id)
      expect(createResponse.status()).toBe(422)
      expect(body?.code).toBe('organization_selection_invalid')
      expect(createResponse.headers()['set-cookie'] ?? '').not.toContain('om_selected_org=;')
    }

    const validCreate = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/companies', {
      token,
      selectedOrgId: organizationId,
      data: { displayName: `TC-DIR-023 Allowed ${fixtureId}` },
    })
    const validBody = await readJsonSafe<{ id?: string }>(validCreate)
    if (validBody?.id) companyIds.push(validBody.id)
    expect(validCreate.status()).toBe(201)
    expect(validBody?.id).toBeTruthy()
  } finally {
    for (const companyId of companyIds) {
      await apiRequest(request, 'DELETE', `/api/customers/companies?id=${encodeURIComponent(companyId)}`, {
        token: administratorToken,
        headers: organizationId ? { Cookie: `om_selected_org=${organizationId}` } : undefined,
      }).catch(() => undefined)
    }
    await deleteUserIfExists(request, administratorToken, userId)
    await deleteOrganizationIfExists(request, administratorToken, otherOrganizationId)
    await deleteOrganizationIfExists(request, administratorToken, organizationId)
  }
})
