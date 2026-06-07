import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type SearchResultItem = { entityId?: string; presenter?: { title?: string } | null }
type SearchResponse = { results?: SearchResultItem[] }

const COMPANY_ENTITY = 'customers:customer_company_profile'
const PERSON_ENTITY = 'customers:customer_person_profile'

async function searchResults(
  request: APIRequestContext,
  token: string,
  query: string,
  entityTypes: string,
): Promise<SearchResultItem[]> {
  const params = new URLSearchParams({ q: query, limit: '20', entityTypes })
  const res = await apiRequest(request, 'GET', `/api/search/search?${params.toString()}`, { token })
  if (!res.ok()) return []
  const body = (await readJsonSafe<SearchResponse>(res)) ?? {}
  return Array.isArray(body.results) ? body.results : []
}

/**
 * TC-SEARCH-009: search entityTypes filter isolates entity types
 * Source: issue #2483.
 *
 * Creates a company and a person that share a unique token in their searchable
 * text, then asserts that filtering by entity type returns only that type. Token
 * search (PostgreSQL) is always available; indexing is asynchronous, so results
 * are polled. The unique query token only matches these two fixtures, so a
 * type-filtered response that is non-empty AND uniform proves the filter holds.
 */
test.describe('TC-SEARCH-009: search entityTypes filter isolates entity types', () => {
  test('filtering by company / person type returns only that type', async ({ request }) => {
    test.slow()

    const stamp = Date.now()
    const unique = `QASRCH009${stamp}`
    let token: string | null = null
    let companyId: string | null = null
    let personId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      companyId = await createCompanyFixture(request, token, `${unique} Co`)
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `S9 ${stamp}`,
        displayName: `${unique} Person`,
      })

      // Company-type filter: results appear and every hit is a company.
      await expect
        .poll(
          async () => {
            const results = await searchResults(request, token!, unique, COMPANY_ENTITY)
            return results.length > 0 && results.every((r) => r.entityId === COMPANY_ENTITY)
          },
          { timeout: 15_000 },
        )
        .toBe(true)

      // Person-type filter: results appear and every hit is a person (no company leaks in).
      await expect
        .poll(
          async () => {
            const results = await searchResults(request, token!, unique, PERSON_ENTITY)
            return results.length > 0 && results.every((r) => r.entityId === PERSON_ENTITY)
          },
          { timeout: 15_000 },
        )
        .toBe(true)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
