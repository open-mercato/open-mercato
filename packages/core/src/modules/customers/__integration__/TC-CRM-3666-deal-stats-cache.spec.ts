import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type DealStats = {
  dealsClosedThisPeriod: number
  dealRankInQuarter: number | null
}

async function readStats(request: APIRequestContext, token: string, dealId: string) {
  const response = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}/stats`, { token })
  expect(response.status(), 'read closed deal stats').toBe(200)
  return readJsonSafe<DealStats>(response)
}

test('TC-CRM-3666: closing a peer deal invalidates warmed closure stats', async ({ request }) => {
  const { tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
  const superToken = await getAuthToken(request, 'superadmin')
  const fixtureId = randomUUID()
  let orgId: string | null = null
  let userId: string | null = null
  let token: string | null = null
  let firstDealId: string | null = null
  let peerDealId: string | null = null

  try {
    orgId = await createOrganizationFixture(request, superToken, {
      name: `TC-CRM-3666 ${fixtureId}`,
      tenantId,
    })
    const email = `crm-3666-${fixtureId}@example.com`
    const password = `Aa1!${fixtureId}`
    userId = await createUserFixture(request, superToken, { email, password, organizationId: orgId, roles: [] })
    await setUserAclVisibility(request, superToken, { userId, organizations: null, features: ['customers.*'] })
    const fixtureToken = await getAuthToken(request, email, password)
    token = fixtureToken
    expect(getTokenContext(fixtureToken).organizationId).toBe(orgId)

    const observedDealId = await createDealFixture(request, fixtureToken, {
      title: `TC-CRM-3666 first ${fixtureId}`,
      valueAmount: 100,
      valueCurrency: 'USD',
      closureOutcome: 'won',
    })
    firstDealId = observedDealId
    peerDealId = await createDealFixture(request, fixtureToken, {
      title: `TC-CRM-3666 peer ${fixtureId}`,
      valueAmount: 200,
      valueCurrency: 'USD',
      status: 'open',
    })
    const warmed = await readStats(request, fixtureToken, observedDealId)
    expect(warmed).toMatchObject({ dealsClosedThisPeriod: 1, dealRankInQuarter: 1 })

    await withClient(async (client) => {
      const filters = [peerDealId, tenantId, orgId]
      const result = await client.query(
        "UPDATE customer_deals SET closure_outcome = 'won' WHERE id = $1 AND tenant_id = $2 AND organization_id = $3",
        filters,
      )
      try {
        expect(result.rowCount).toBe(1)
        expect(await readStats(request, fixtureToken, observedDealId)).toEqual(warmed)
      } finally {
        await client.query(
          'UPDATE customer_deals SET closure_outcome = NULL WHERE id = $1 AND tenant_id = $2 AND organization_id = $3',
          filters,
        )
      }
    })

    const close = await apiRequest(request, 'PUT', '/api/customers/deals', {
      token: fixtureToken,
      data: { id: peerDealId, closureOutcome: 'won' },
    })
    expect(close.status(), 'close the higher-value deal through the API').toBe(200)
    expect(await readStats(request, fixtureToken, observedDealId)).toMatchObject({
      dealsClosedThisPeriod: 2,
      dealRankInQuarter: 2,
    })
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/deals', peerDealId)
    await deleteEntityIfExists(request, token, '/api/customers/deals', firstDealId)
    await deleteUserIfExists(request, superToken, userId)
    await deleteOrganizationIfExists(request, superToken, orgId)
  }
})
