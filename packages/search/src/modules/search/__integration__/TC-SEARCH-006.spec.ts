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
type SearchQueryResult = { ok: boolean; status: number; results: SearchResultItem[] }

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
): Promise<SearchQueryResult> {
  const response = await apiRequest(request, 'GET', path, { token })
  if (!response.ok()) return { ok: false, status: response.status(), results: [] }
  const body = (await readJsonSafe<GlobalSearchResponse>(response)) ?? {}
  return {
    ok: true,
    status: response.status(),
    results: Array.isArray(body.results) ? body.results : [],
  }
}

function customerSearchPath(query: string, entityType: string): string {
  const params = new URLSearchParams({
    q: query,
    limit: '20',
    strategies: 'tokens',
    entityTypes: entityType,
  })
  return `/api/search/search?${params.toString()}`
}

function globalSearchPath(query: string): string {
  const params = new URLSearchParams({ q: query, limit: '20' })
  return `/api/search/search/global?${params.toString()}`
}

/**
 * A profile result navigates to the customer's v2 detail page, whose path segment is the base
 * customer entity id — not the profile's own `recordId`. So this asserts the shape of a direct
 * detail link (prefix + one non-empty id segment, no query string or anchor) rather than
 * equality with `recordId`.
 */
function hasCanonicalNavigation(result: SearchResultItem, expectedPrefix: string): boolean {
  if (typeof result.url !== 'string') return false
  if (!result.url.startsWith(`${expectedPrefix}/`)) return false
  const target = result.url.slice(expectedPrefix.length + 1)
  return target.length > 0 && !/[/?#]/.test(target)
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

  test('returns one navigable profile result per customer and no base-entity duplicate', async ({ request }) => {
    test.slow()
    test.setTimeout(120_000)

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
            const [personEntity, personProfile, companyEntity, companyProfile, personGlobal, companyGlobal] =
              await Promise.all([
                searchResults(request, token!, customerSearchPath(personName, CUSTOMER_ENTITY)),
                searchResults(request, token!, customerSearchPath(personName, PERSON_PROFILE)),
                searchResults(request, token!, customerSearchPath(companyName, CUSTOMER_ENTITY)),
                searchResults(request, token!, customerSearchPath(companyName, COMPANY_PROFILE)),
                searchResults(request, token!, globalSearchPath(personName)),
                searchResults(request, token!, globalSearchPath(companyName)),
              ])

            const queries = [
              ['person-entity', personEntity],
              ['person-profile', personProfile],
              ['company-entity', companyEntity],
              ['company-profile', companyProfile],
              ['person-global', personGlobal],
              ['company-global', companyGlobal],
            ] as const
            const failedQuery = queries.find(([, result]) => !result.ok)
            if (failedQuery) return `${failedQuery[0]}:status:${failedQuery[1].status}`

            const indexedQueries = [
              ['person-profile', personProfile.results, personName, PERSON_PROFILE],
              ['company-profile', companyProfile.results, companyName, COMPANY_PROFILE],
            ] as const
            for (const [label, results, expectedTitle, expectedEntityId] of indexedQueries) {
              const matches = results.filter(
                (result) => presenterTitle(result) === expectedTitle && result.entityId === expectedEntityId,
              )
              if (matches.length === 0) return `${label}:matches:0`
            }

            // Under the default OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY=false the token strategy
            // refuses to return base customer rows, so an explicit query for that entity type is
            // empty even though the same customers' profiles are already indexed above. (The rows
            // themselves stay in search_tokens — the list-search id lookup still needs them.)
            const baseEntityQueries = [
              ['person-entity', personEntity.results, personName],
              ['company-entity', companyEntity.results, companyName],
            ] as const
            for (const [label, results, expectedTitle] of baseEntityQueries) {
              const matches = results.filter((result) => presenterTitle(result) === expectedTitle)
              if (matches.length !== 0) return `${label}:matches:${matches.length}`
            }

            personGlobalResults = personGlobal.results.filter((result) => presenterTitle(result) === personName)
            companyGlobalResults = companyGlobal.results.filter((result) => presenterTitle(result) === companyName)
            if (personGlobalResults.length !== 1) return `person-global:matches:${personGlobalResults.length}`
            if (companyGlobalResults.length !== 1) return `company-global:matches:${companyGlobalResults.length}`
            if (personGlobalResults[0]?.entityId !== PERSON_PROFILE) {
              return `person-global:entity:${personGlobalResults[0]?.entityId ?? 'missing'}`
            }
            if (companyGlobalResults[0]?.entityId !== COMPANY_PROFILE) {
              return `company-global:entity:${companyGlobalResults[0]?.entityId ?? 'missing'}`
            }
            if (!hasCanonicalNavigation(personGlobalResults[0], '/backend/customers/people-v2')) {
              return `person-global:navigation:${personGlobalResults[0]?.url ?? 'missing'}`
            }
            if (!hasCanonicalNavigation(companyGlobalResults[0], '/backend/customers/companies-v2')) {
              return `company-global:navigation:${companyGlobalResults[0]?.url ?? 'missing'}`
            }

            return 'ready'
          },
          { timeout: 10_000 },
        )
        .toBe('ready')

      expect(personGlobalResults).toHaveLength(1)
      expect(personGlobalResults[0]?.entityId).toBe(PERSON_PROFILE)
      expect(companyGlobalResults).toHaveLength(1)
      expect(companyGlobalResults[0]?.entityId).toBe(COMPANY_PROFILE)
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
