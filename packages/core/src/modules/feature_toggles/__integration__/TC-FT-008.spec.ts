import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { uniqueToggleIdentifier } from './featureToggleTestHelpers'

type ToggleListItem = {
  id?: string
  identifier?: string
  name?: string
  category?: string | null
  type?: string
}

type ToggleListResponse = {
  items?: ToggleListItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

async function fetchToggleList(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  path: string,
): Promise<ToggleListResponse> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<ToggleListResponse>(response)) ?? {}
}

test.describe('TC-FT-008: List endpoint filtering and pagination', () => {
  test('filters, sorts, and paginates global toggles', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const stamp = Date.now().toString(36)
    const identifierPrefix = `qa_ft_${stamp}`
    const identifiers = [
      `${identifierPrefix}_search_one`,
      `${identifierPrefix}_search_two`,
      `${identifierPrefix}_filter_boolean`,
    ]
    const createdToggleIds: string[] = []

    try {
      createdToggleIds.push(await createFeatureToggleFixture(request, token, {
        identifier: identifiers[0],
        name: `QA Payment Search One ${stamp}`,
        description: 'Payment category search coverage',
        category: 'payment',
        type: 'string',
        defaultValue: 'enabled',
      }))
      createdToggleIds.push(await createFeatureToggleFixture(request, token, {
        identifier: identifiers[1],
        name: `QA Payment Search Two ${stamp}`,
        description: 'Payment category search coverage',
        category: 'payment',
        type: 'number',
        defaultValue: 2,
      }))
      createdToggleIds.push(await createFeatureToggleFixture(request, token, {
        identifier: identifiers[2],
        name: `QA Auth Filter Boolean ${stamp}`,
        description: 'Auth category filter coverage',
        category: 'auth',
        type: 'boolean',
        defaultValue: true,
      }))

      const listPath = `/api/feature_toggles/global?identifier=${encodeURIComponent(identifierPrefix)}&page=1&pageSize=10`
      await expect
        .poll(
          async () => (await fetchToggleList(request, token, listPath)).items?.map((item) => item.id) ?? [],
          { timeout: 10_000 },
        )
        .toEqual(expect.arrayContaining(createdToggleIds))
      const listBody = await fetchToggleList(request, token, listPath)
      expect(listBody?.items?.map((item) => item.id)).toEqual(expect.arrayContaining(createdToggleIds))

      const searchResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?search=payment&identifier=${encodeURIComponent(identifierPrefix)}`,
        { token },
      )
      expect(searchResponse.status()).toBe(200)
      const searchBody = await readJsonSafe<ToggleListResponse>(searchResponse)
      expect(searchBody?.items?.map((item) => item.identifier)).toEqual(expect.arrayContaining(identifiers.slice(0, 2)))
      expect(searchBody?.items?.some((item) => item.identifier === identifiers[2])).toBe(false)

      const categoryResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?category=auth&identifier=${encodeURIComponent(identifiers[2])}`,
        { token },
      )
      expect(categoryResponse.status()).toBe(200)
      const categoryBody = await readJsonSafe<ToggleListResponse>(categoryResponse)
      expect(categoryBody?.items).toEqual([
        expect.objectContaining({ identifier: identifiers[2], category: 'auth' }),
      ])

      const typeResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?type=boolean&identifier=${encodeURIComponent(identifiers[2])}`,
        { token },
      )
      expect(typeResponse.status()).toBe(200)
      const typeBody = await readJsonSafe<ToggleListResponse>(typeResponse)
      expect(typeBody?.items).toEqual([
        expect.objectContaining({ identifier: identifiers[2], type: 'boolean' }),
      ])

      const nameResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?name=${encodeURIComponent(`Payment Search One ${stamp}`)}`,
        { token },
      )
      expect(nameResponse.status()).toBe(200)
      const nameBody = await readJsonSafe<ToggleListResponse>(nameResponse)
      expect(nameBody?.items?.some((item) => item.identifier === identifiers[0])).toBe(true)

      const pageOneResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?identifier=${encodeURIComponent(identifierPrefix)}&page=1&pageSize=2&sortField=identifier&sortDir=asc`,
        { token },
      )
      expect(pageOneResponse.status()).toBe(200)
      const pageOneBody = await readJsonSafe<ToggleListResponse>(pageOneResponse)
      expect(pageOneBody).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 })
      expect(pageOneBody?.items).toHaveLength(2)

      const pageTwoResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?identifier=${encodeURIComponent(identifierPrefix)}&page=2&pageSize=2&sortField=identifier&sortDir=asc`,
        { token },
      )
      expect(pageTwoResponse.status()).toBe(200)
      const pageTwoBody = await readJsonSafe<ToggleListResponse>(pageTwoResponse)
      expect(pageTwoBody?.items).toHaveLength(1)

      const sortedAscResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?identifier=${encodeURIComponent(identifierPrefix)}&pageSize=3&sortField=id&sortDir=asc`,
        { token },
      )
      const sortedDescResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?identifier=${encodeURIComponent(identifierPrefix)}&pageSize=3&sortField=id&sortDir=desc`,
        { token },
      )
      expect(sortedAscResponse.status()).toBe(200)
      expect(sortedDescResponse.status()).toBe(200)
      const sortedAscBody = await readJsonSafe<ToggleListResponse>(sortedAscResponse)
      const sortedDescBody = await readJsonSafe<ToggleListResponse>(sortedDescResponse)
      expect(sortedAscBody?.items?.map((item) => item.id)).toEqual([...createdToggleIds].sort())
      expect(sortedDescBody?.items?.map((item) => item.id)).toEqual([...createdToggleIds].sort().reverse())

      const emptyResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?search=${encodeURIComponent(`no_match_${stamp}`)}`,
        { token },
      )
      expect(emptyResponse.status()).toBe(200)
      const emptyBody = await readJsonSafe<ToggleListResponse>(emptyResponse)
      expect(emptyBody).toMatchObject({ items: [], total: 0 })
    } finally {
      for (const toggleId of createdToggleIds) {
        await deleteFeatureToggleIfExists(request, token, toggleId)
      }
    }
  })
})
