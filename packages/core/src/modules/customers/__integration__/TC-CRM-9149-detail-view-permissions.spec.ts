import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('CRM detail respects the related-deal permission on both record types', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenScope(adminToken)
  const marker = randomUUID()
  const email = `crm-reader-${marker}@example.test`
  const password = `Qa1!-${randomUUID()}`
  const recordFeatures = ['customers.people.view', 'customers.companies.view']
  let roleId: string | null = null
  let userId: string | null = null
  let companyId: string | null = null
  let personId: string | null = null
  let dealId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, { name: `crm-reader-${marker}`, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: [...recordFeatures, 'customers.deals.view'],
    })
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
    companyId = await createCompanyFixture(request, adminToken, `Company ${marker}`)
    personId = await createPersonFixture(request, adminToken, {
      firstName: 'CRM',
      lastName: 'Reader',
      displayName: `Person ${marker}`,
      companyEntityId: companyId,
    })
    dealId = await createDealFixture(request, adminToken, {
      title: `Deal ${marker}`,
      companyIds: [companyId],
      personIds: [personId],
      status: 'open',
    })
    const readerToken = await getAuthToken(request, email, password)
    const details = [
      { key: 'company', id: companyId, path: `/api/customers/companies/${companyId}` },
      { key: 'person', id: personId, path: `/api/customers/people/${personId}` },
    ]

    for (const { path } of details) {
      const response = await apiRequest(request, 'GET', `${path}?include=deals`, { token: readerToken })
      expect(response.status()).toBe(200)
      expect(await readJsonSafe(response)).toMatchObject({ deals: [{ id: dealId }], counts: { deals: 1 } })
    }

    await setRoleAclFeatures(request, adminToken, { roleId, features: recordFeatures })

    for (const { key, id, path } of details) {
      const response = await apiRequest(request, 'GET', `${path}?include=deals`, { token: readerToken })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe(response)
      expect(body).toMatchObject({
        [key]: { id, nextInteractionAt: null, nextInteractionRefId: null },
        deals: [],
        counts: { deals: 0, interactions: 0 },
      })
      expect(body).not.toHaveProperty('plannedActivitiesPreview')
      expect(body).not.toHaveProperty('kpis.activeDealsCount')
      expect(body).not.toHaveProperty('kpis.ltvValue')
    }
  } finally {
    await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
