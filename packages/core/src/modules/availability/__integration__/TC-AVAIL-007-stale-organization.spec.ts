import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['availability', 'auth', 'directory'] }

test('TC-AVAIL-007: all availability reads reject stale or inaccessible organization selections', async ({ request }) => {
  const administratorToken = await getAuthToken(request, 'superadmin')
  const tenantId = expectId(getTokenContext(administratorToken).tenantId, 'Tenant context is required')
  const stamp = randomUUID()
  const email = `qa-avail-007-${stamp}@example.com`
  const password = `Test-${stamp}!`
  let organizationId: string | null = null
  let ungrantedOrganizationId: string | null = null
  let userId: string | null = null

  try {
    organizationId = await createOrganizationFixture(request, administratorToken, {
      tenantId, name: `TC-AVAIL-007 allowed ${stamp}`,
    })
    ungrantedOrganizationId = await createOrganizationFixture(request, administratorToken, {
      tenantId, name: `TC-AVAIL-007 unauthorized ${stamp}`,
    })
    userId = await createUserFixture(request, administratorToken, { email, password, organizationId, roles: [] })
    await setUserAclVisibility(request, administratorToken, {
      userId,
      organizations: [organizationId],
      features: ['availability.policies.view', 'availability.check'],
    })
    const token = await getAuthToken(request, email, password)
    const productId = randomUUID()
    const policies = '/api/availability/policies'
    const preview = `${policies}/resolve-preview?productId=${productId}`
    const check = '/api/availability/check'
    const allowed = await apiRequestWithSelectedOrg(request, 'GET', policies, { token, selectedOrgId: organizationId })
    expect(allowed.status()).toBe(200)

    for (const selectedOrgId of [ungrantedOrganizationId, randomUUID()]) {
      const rejected = [
        await apiRequestWithSelectedOrg(request, 'GET', policies, { token, selectedOrgId }),
        await apiRequestWithSelectedOrg(request, 'GET', preview, { token, selectedOrgId }),
        await apiRequestWithSelectedOrg(request, 'POST', check, { token, selectedOrgId, data: { productId, quantity: 1 } }),
      ]
      for (const response of rejected) {
        expect(response.status()).toBe(422)
        expect(response.headers()['set-cookie']).toContain('om_selected_org=;')
        const body = await readJsonSafe(response)
        expect(body).toMatchObject({ code: 'organization_selection_invalid' })
        for (const dataField of ['items', 'availability', 'policyTrace']) {
          expect(body).not.toHaveProperty(dataField)
        }
      }
    }
  } finally {
    await deleteUserIfExists(request, administratorToken, userId)
    await deleteOrganizationIfExists(request, administratorToken, ungrantedOrganizationId)
    await deleteOrganizationIfExists(request, administratorToken, organizationId)
  }
})
