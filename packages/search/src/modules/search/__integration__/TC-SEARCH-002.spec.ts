import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type JsonRecord = Record<string, unknown>

type SearchSettingsResponse = {
  settings?: {
    strategies?: Array<{
      id?: unknown
      available?: unknown
    }>
    tokensEnabled?: unknown
  }
}

type SearchResultPayload = {
  entityId?: unknown
  recordId?: unknown
  source?: unknown
  presenter?: unknown
  url?: unknown
  links?: unknown
  metadata?: unknown
}

type SearchResponse = {
  results?: SearchResultPayload[]
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function requireValue<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value == null) {
    throw new Error(message)
  }

  return value as NonNullable<T>
}

async function readJson<T extends JsonRecord>(response: APIResponse): Promise<T> {
  return ((await readJsonSafe<T>(response)) ?? {}) as T
}

function getPresenterTitle(result: SearchResultPayload): string | null {
  if (!isRecord(result.presenter)) return null
  const title = result.presenter.title
  return typeof title === 'string' && title.trim().length > 0 ? title : null
}

function getSources(result: SearchResultPayload): string[] {
  if (!isRecord(result.metadata)) return []
  const rawSources = result.metadata._sources
  if (!Array.isArray(rawSources)) return []
  return rawSources.filter((source): source is string => typeof source === 'string').sort()
}

function getLinks(result: SearchResultPayload): Array<{ href?: unknown; label?: unknown; kind?: unknown }> {
  return Array.isArray(result.links)
    ? result.links.filter((link): link is { href?: unknown; label?: unknown; kind?: unknown } => isRecord(link))
    : []
}

function hasStrategy(
  settings: SearchSettingsResponse,
  id: string,
): boolean {
  const strategies = Array.isArray(settings.settings?.strategies) ? settings.settings.strategies : []
  return strategies.some((strategy) => strategy.id === id && strategy.available === true)
}

function buildSearchPath(query: string): string {
  const params = new URLSearchParams({
    q: query,
    limit: '10',
    strategies: 'fulltext,tokens',
    entityTypes: 'customers:customer_company_profile',
  })
  return `/api/search/search?${params.toString()}`
}

test.describe('TC-SEARCH-002: search endpoint merges duplicate strategy hits', () => {
  test('returns a single merged company result with both token and fulltext sources', async ({ request }) => {
    let token: string | null = null
    let companyId: string | null = null

    const uniqueCompanyName = `QATCSEARCH002${Date.now()}`
    let mergedResult: SearchResultPayload | null = null

    try {
      const authToken = await getAuthToken(request, 'superadmin')
      token = authToken

      const settingsResponse = await apiRequest(request, 'GET', '/api/search/settings', { token: authToken })
      expect(settingsResponse.ok()).toBeTruthy()
      const settings = await readJson<SearchSettingsResponse>(settingsResponse)

      if (!hasStrategy(settings, 'fulltext')) {
        test.skip(true, 'Fulltext strategy is not available in this environment')
        return
      }

      if (settings.settings?.tokensEnabled !== true) {
        test.skip(true, 'Token search is disabled in this environment')
        return
      }

      companyId = await createCompanyFixture(request, authToken, uniqueCompanyName)

      await expect
        .poll(
          async () => {
            const searchResponse = await apiRequest(request, 'GET', buildSearchPath(uniqueCompanyName), {
              token: authToken,
            })
            if (!searchResponse.ok()) {
              mergedResult = null
              return 'response-not-ok'
            }

            const searchBody = await readJson<SearchResponse>(searchResponse)
            const results = Array.isArray(searchBody.results) ? searchBody.results : []
            const matchingResults = results.filter((result) => getPresenterTitle(result) === uniqueCompanyName)

            if (matchingResults.length !== 1) {
              mergedResult = null
              return `matches:${matchingResults.length}`
            }

            const candidate = matchingResults[0]
            const sources = getSources(candidate)
            if (sources.join(',') !== 'fulltext,tokens') {
              mergedResult = null
              return sources.join(',') || 'missing-sources'
            }

            mergedResult = candidate
            return sources.join(',')
          },
          { timeout: 15_000 },
        )
        .toBe('fulltext,tokens')

      const ensuredMergedResult = requireValue<SearchResultPayload>(
        mergedResult,
        'Expected merged result from search response',
      )

      expect(ensuredMergedResult.source).toBe('fulltext')
      expect(getPresenterTitle(ensuredMergedResult)).toBe(uniqueCompanyName)

      const metadata = isRecord(ensuredMergedResult.metadata) ? ensuredMergedResult.metadata : {}
      expect(typeof metadata._rrfScore).toBe('number')

      expect(ensuredMergedResult.entityId).toBe('customers:customer_company_profile')

      expect(typeof ensuredMergedResult.url).toBe('string')
      expect(ensuredMergedResult.url).toContain('/backend/customers/companies/')

      const links = getLinks(ensuredMergedResult)
      expect(
        links.some((link) => typeof link.href === 'string' && link.href.includes('/backend/customers/companies/')),
      ).toBeTruthy()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
