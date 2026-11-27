import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['wms'] }

const WAREHOUSES_PATH = '/api/wms/warehouses'

type WarehouseList = { items?: Array<{ id?: string; city?: string | null; code?: string }> }

async function readList(request: APIRequestContext, token: string, query: URLSearchParams): Promise<WarehouseList> {
  const response = await apiRequest(request, 'GET', `${WAREHOUSES_PATH}?${query}`, { token })
  expect(response.status(), 'GET /api/wms/warehouses should answer 200').toBe(200)
  return (await readJsonSafe<WarehouseList>(response)) ?? {}
}

test('TC-WMS-9548: warehouse list sorts by UI column keys and search returns the exact code (#9548, #5803)', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID().slice(0, 8)
  const ids: string[] = []
  const fixtures = [
    { city: 'Madrid', code: `Q9548-2026-01-${stamp}` },
    { city: 'Amsterdam', code: `Q9548-2026-08-${stamp}` },
    { city: 'Zurich', code: `Q9548-2026-11-${stamp}` },
  ]

  try {
    for (const fixture of fixtures) {
      const response = await apiRequest(request, 'POST', WAREHOUSES_PATH, {
        token,
        data: { name: `QA9548 ${fixture.city} ${stamp}`, code: fixture.code, city: fixture.city, isActive: true },
      })
      expect(response.status(), 'POST /api/wms/warehouses should create the fixture').toBe(201)
      ids.push(expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Warehouse creation should return an id'))
    }

    for (const [sortDir, expected] of [['desc', ['Zurich', 'Madrid', 'Amsterdam']], ['asc', ['Amsterdam', 'Madrid', 'Zurich']]] as const) {
      const body = await readList(request, token, new URLSearchParams({ ids: ids.join(','), sortField: 'city', sortDir, pageSize: '10' }))
      expect((body.items ?? []).map((item) => item.city), `city ${sortDir} should sort on the server`).toEqual(expected)
    }

    const search = await readList(request, token, new URLSearchParams({ search: fixtures[1].code, pageSize: '10' }))
    expect((search.items ?? []).map((item) => item.code), 'Search must return only the warehouse whose code matches').toEqual([fixtures[1].code])
  } finally {
    for (const id of ids) {
      await apiRequest(request, 'DELETE', `${WAREHOUSES_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
    }
  }
})
