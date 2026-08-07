import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type GlobalSearchSettings = { enabledStrategies?: string[] }
type GlobalSearchUpdate = { ok?: boolean; enabledStrategies?: string[] }
type SearchResultItem = {
  entityId?: string
  recordId?: string
  presenter?: { title?: string } | null
  url?: string | null
}
type GlobalSearchResponse = { strategiesEnabled?: string[]; results?: SearchResultItem[] }

const DEFAULT_STRATEGIES = ['fulltext', 'vector', 'tokens']
const CUSTOMER_ENTITY = 'customers:customer_entity'
const PERSON_PROFILE = 'customers:customer_person_profile'
const COMPANY_PROFILE = 'customers:customer_company_profile'

function presenterTitle(result: SearchResultItem): string | null {
  const title = result.presenter?.title
  return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null
}

async function searchResults(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<SearchResultItem[]> {
  const response = await apiRequest(request, 'GET', path, { token })
  if (!response.ok()) return []
  const body = (await readJsonSafe<GlobalSearchResponse>(response)) ?? {}
  return Array.isArray(body.results) ? body.results : []
}

function customerSearchPath(query: string, profileEntity: string): string {
  const params = new URLSearchParams({
    q: query,
    limit: '20',
    strategies: 'tokens',
    entityTypes: `${CUSTOMER_ENTITY},${profileEntity}`,
  })
  return `/api/search/search?${params.toString()}`
}

function globalSearchPath(query: string): string {
  const params = new URLSearchParams({ q: query, limit: '20' })
  return `/api/search/search/global?${params.toString()}`
}

function hasCanonicalNavigation(result: SearchResultItem, expectedPrefix: string): boolean {
  if (typeof result.url !== 'string' || typeof result.recordId !== 'string') return false
  return result.url === `${expectedPrefix}/${encodeURIComponent(result.recordId)}`
}

/**
 * TC-SEARCH-006: global (Cmd+K) search honors the saved strategy config over a
 * URL override. Source: issue #2483.
 *
 * Routes:
 *   - GET/POST /api/search/settings/global-search  (POST requires search.manage)
 *   - GET /api/search/search/global                 (ignores any `strategies` URL param)
 *
 * Saves enabledStrategies = ['tokens'], then calls global search with a
 * conflicting ?strategies=fulltext,vector and asserts the response's
 * strategiesEnabled reflects the SAVED config, not the URL. The original config
 * is restored in `finally`. `admin` holds both search.view and search.manage.
 */
test.describe('TC-SEARCH-006: global search honors saved strategy config over URL override', () => {
  test('persisted enabledStrategies wins over the strategies URL parameter', async ({ request }) => {
    test.slow()
    test.setTimeout(120_000)

    let token: string | null = null
    let originalStrategies: string[] | null = DEFAULT_STRATEGIES

    try {
      token = await getAuthToken(request, 'admin')

      const currentRes = await apiRequest(request, 'GET', '/api/search/settings/global-search', { token })
      expect(currentRes.ok(), 'GET global-search settings should succeed').toBeTruthy()
      const current = (await readJsonSafe<GlobalSearchSettings>(currentRes)) ?? {}
      expect(Array.isArray(current.enabledStrategies), 'settings expose an enabledStrategies array').toBe(true)
      originalStrategies =
        Array.isArray(current.enabledStrategies) && current.enabledStrategies.length > 0
          ? current.enabledStrategies
          : DEFAULT_STRATEGIES

      const updateRes = await apiRequest(request, 'POST', '/api/search/settings/global-search', {
        token,
        data: { enabledStrategies: ['tokens'] },
      })
      expect(updateRes.status(), 'POST global-search settings should return 200').toBe(200)
      const updated = (await readJsonSafe<GlobalSearchUpdate>(updateRes)) ?? {}
      expect(updated.ok, 'update reports ok').toBe(true)
      expect(updated.enabledStrategies, 'update echoes the saved strategies').toEqual(['tokens'])

      const globalRes = await apiRequest(
        request,
        'GET',
        `/api/search/search/global?q=qa-search-006-${Date.now()}&strategies=fulltext,vector`,
        { token },
      )
      expect(globalRes.ok(), 'GET global search should succeed').toBeTruthy()
      const globalBody = (await readJsonSafe<GlobalSearchResponse>(globalRes)) ?? {}
      expect(
        globalBody.strategiesEnabled,
        'global search must use the saved config (tokens), ignoring the strategies URL override',
      ).toEqual(['tokens'])
    } finally {
      if (token && originalStrategies) {
        await apiRequest(request, 'POST', '/api/search/settings/global-search', {
          token,
          data: { enabledStrategies: originalStrategies },
        }).catch(() => undefined)
      }
    }
  })

  test('deduplicates real person and company profile hits into canonical global results', async ({ request }) => {
    const stamp = Date.now()
    const personName = `QASRCH006P${stamp}`
    const companyName = `QASRCH006C${stamp}`
    let token: string | null = null
    let originalStrategies: string[] | null = DEFAULT_STRATEGIES
    let personId: string | null = null
    let companyId: string | null = null
    let personGlobalResults: SearchResultItem[] = []
    let companyGlobalResults: SearchResultItem[] = []

    try {
      token = await getAuthToken(request, 'admin')

      const currentRes = await apiRequest(request, 'GET', '/api/search/settings/global-search', { token })
      expect(currentRes.ok(), 'GET global-search settings should succeed').toBeTruthy()
      const current = (await readJsonSafe<GlobalSearchSettings>(currentRes)) ?? {}
      originalStrategies =
        Array.isArray(current.enabledStrategies) && current.enabledStrategies.length > 0
          ? current.enabledStrategies
          : DEFAULT_STRATEGIES

      const updateRes = await apiRequest(request, 'POST', '/api/search/settings/global-search', {
        token,
        data: { enabledStrategies: ['tokens'] },
      })
      expect(updateRes.status(), 'POST global-search settings should return 200').toBe(200)

      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `Search 006 ${stamp}`,
        displayName: personName,
      })
      companyId = await createCompanyFixture(request, token, companyName)

      await expect
        .poll(
          async () => {
            const [personRaw, companyRaw, personGlobal, companyGlobal] = await Promise.all([
              searchResults(request, token!, customerSearchPath(personName, PERSON_PROFILE)),
              searchResults(request, token!, customerSearchPath(companyName, COMPANY_PROFILE)),
              searchResults(request, token!, globalSearchPath(personName)),
              searchResults(request, token!, globalSearchPath(companyName)),
            ])

            const personRawTypes = new Set(
              personRaw.filter((result) => presenterTitle(result) === personName).map((result) => result.entityId),
            )
            const companyRawTypes = new Set(
              companyRaw.filter((result) => presenterTitle(result) === companyName).map((result) => result.entityId),
            )
            personGlobalResults = personGlobal.filter((result) => presenterTitle(result) === personName)
            companyGlobalResults = companyGlobal.filter((result) => presenterTitle(result) === companyName)

            return (
              personRawTypes.has(CUSTOMER_ENTITY) &&
              personRawTypes.has(PERSON_PROFILE) &&
              companyRawTypes.has(CUSTOMER_ENTITY) &&
              companyRawTypes.has(COMPANY_PROFILE) &&
              personGlobalResults.length === 1 &&
              companyGlobalResults.length === 1 &&
              hasCanonicalNavigation(personGlobalResults[0] ?? {}, '/backend/customers/people-v2') &&
              hasCanonicalNavigation(companyGlobalResults[0] ?? {}, '/backend/customers/companies-v2')
            )
          },
          { timeout: 10_000 },
        )
        .toBe(true)

      expect(personGlobalResults).toHaveLength(1)
      expect(personGlobalResults[0]?.entityId).toBe(CUSTOMER_ENTITY)
      expect(companyGlobalResults).toHaveLength(1)
      expect(companyGlobalResults[0]?.entityId).toBe(CUSTOMER_ENTITY)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      if (token && originalStrategies) {
        await apiRequest(request, 'POST', '/api/search/settings/global-search', {
          token,
          data: { enabledStrategies: originalStrategies },
        }).catch(() => undefined)
      }
    }
  })
})
