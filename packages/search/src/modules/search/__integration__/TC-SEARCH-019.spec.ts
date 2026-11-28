import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createCustomerUserFixture, deleteCustomerUserFixture } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['search', 'customers', 'customer_accounts'] }

type SearchResponse = {
  results?: Array<{ entityId: string; source: string; url?: string; presenter?: { title?: string } }>
}

test('TC-SEARCH-019: customer records remain searchable by tokens and vector reindex queues no work', async ({ request }) => {
  test.slow()

  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID().replaceAll('-', '').slice(0, 10)
  const personName = `QaPerson${stamp}`
  const companyName = `QaCompany${stamp}`
  const userName = `QaAccount${stamp}`
  let personId: string | null = null
  let companyId: string | null = null
  let userId: string | null = null
  let vectorReindexQueued = false

  try {
    personId = await createPersonFixture(request, token, {
      firstName: 'QA', lastName: personName, displayName: personName,
    })
    companyId = await createCompanyFixture(request, token, companyName)
    userId = (await createCustomerUserFixture(request, token, { displayName: userName })).id

    const fixtures = [
      { entityId: 'customers:customer_person_profile', title: personName, url: `/backend/customers/people-v2/${personId}` },
      { entityId: 'customers:customer_company_profile', title: companyName, url: `/backend/customers/companies-v2/${companyId}` },
      { entityId: 'customer_accounts:customer_user', title: userName, url: `/backend/customer-accounts/users/${userId}` },
    ]

    for (const { entityId, title, url } of fixtures) {
      const reindex = await apiRequest(request, 'POST', '/api/search/embeddings/reindex', {
        token, data: { entityId },
      })
      expect(reindex.status(), `${entityId} vector reindex`).toBe(200)
      const result = await readJsonSafe<{ ok?: boolean; recordsIndexed?: number; jobsEnqueued?: number }>(reindex)
      vectorReindexQueued = (result?.jobsEnqueued ?? 0) > 0
      expect(result, `${entityId} is ineligible for vector reindex`).toMatchObject({
        ok: true, recordsIndexed: 0, jobsEnqueued: 0,
      })

      const params = new URLSearchParams({ q: title, strategies: 'tokens', entityTypes: entityId })
      await expect.poll(async () => {
        const response = await apiRequest(request, 'GET', `/api/search/search?${params}`, { token })
        expect(response.status(), `${entityId} token search`).toBe(200)
        return (await readJsonSafe<SearchResponse>(response))?.results ?? []
      }, { message: `${entityId} remains discoverable by its display name`, timeout: 15_000 }).toContainEqual(
        expect.objectContaining({ entityId, source: 'tokens', url, presenter: expect.objectContaining({ title }) }),
      )
    }
  } finally {
    if (vectorReindexQueued) {
      await apiRequest(request, 'POST', '/api/search/embeddings/reindex/cancel', { token }).catch(() => undefined)
    }
    await deleteCustomerUserFixture(request, token, userId)
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
