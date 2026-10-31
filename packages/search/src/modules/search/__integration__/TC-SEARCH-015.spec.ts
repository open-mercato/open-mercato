import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type SearchSettingsResponse = {
  settings?: {
    strategies?: Array<{ id?: unknown; available?: unknown }>
  }
}

type SearchResponse = {
  results?: Array<{ entityId?: unknown; recordId?: unknown; presenter?: { title?: unknown } | null }>
}

const COMPANY_ENTITY = 'customers:customer_company_profile'
const PERSON_ENTITY = 'customers:customer_person_profile'

async function readJson<T>(response: APIResponse): Promise<T> {
  return ((await readJsonSafe<T>(response)) ?? {}) as T
}

async function countFulltextCompanyHits(request: APIRequestContext, token: string, name: string): Promise<number> {
  const params = new URLSearchParams({ q: name, limit: '10', strategies: 'fulltext', entityTypes: COMPANY_ENTITY })
  const response = await apiRequest(request, 'GET', `/api/search/search?${params.toString()}`, { token })
  if (!response.ok()) return -1
  const body = await readJson<SearchResponse>(response)
  const results = Array.isArray(body.results) ? body.results : []
  return results.filter((result) => result.entityId === COMPANY_ENTITY && result.presenter?.title === name).length
}

/**
 * TC-SEARCH-015: reindexing one entity type keeps the other entity types searchable.
 *
 * Meilisearch keeps one index per tenant shared by every entity type and organization.
 * POST /api/search/reindex with an `entityId` must clear and rebuild only that entity's
 * documents; it must not drop the tenant index and leave other entity types unsearchable.
 * Skips when the environment has no fulltext (Meilisearch) backend.
 */
test.describe('TC-SEARCH-015: entity-scoped fulltext reindex keeps other entity types searchable', () => {
  test('reindexing people keeps an indexed company in fulltext results', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let companyId: string | null = null
    const companyName = `QATCSEARCH015${Date.now()}`

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token

      const settingsResponse = await apiRequest(request, 'GET', '/api/search/settings', { token: authToken })
      expect(settingsResponse.ok()).toBeTruthy()
      const settings = await readJson<SearchSettingsResponse>(settingsResponse)
      const strategies = Array.isArray(settings.settings?.strategies) ? settings.settings.strategies : []
      if (!strategies.some((strategy) => strategy.id === 'fulltext' && strategy.available === true)) {
        test.skip(true, 'Fulltext strategy is not available in this environment')
        return
      }

      await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token: authToken }).catch(() => undefined)

      companyId = await createCompanyFixture(request, authToken, companyName)

      const companyReindex = await apiRequest(request, 'POST', '/api/search/reindex', {
        token: authToken,
        data: { entityId: COMPANY_ENTITY, useQueue: false },
      })
      expect(companyReindex.status(), 'company reindex must succeed').toBe(200)

      await expect
        .poll(() => countFulltextCompanyHits(request, authToken, companyName), { timeout: 30_000 })
        .toBe(1)

      const personReindex = await apiRequest(request, 'POST', '/api/search/reindex', {
        token: authToken,
        data: { entityId: PERSON_ENTITY, useQueue: false },
      })
      expect(personReindex.status(), 'entity-scoped reindex must succeed').toBe(200)

      for (let check = 0; check < 5; check += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        expect(
          await countFulltextCompanyHits(request, authToken, companyName),
          `company must stay searchable after reindexing ${PERSON_ENTITY} (check ${check + 1})`,
        ).toBe(1)
      }
    } finally {
      if (token) {
        await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
