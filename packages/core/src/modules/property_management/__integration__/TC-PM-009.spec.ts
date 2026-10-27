import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, deleteBuildingIfExists, stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'

type SearchResult = { entityId?: string; recordId?: string }

const MODULE_PREFIX = 'property_management:'

async function readStrategies(request: APIRequestContext, token: string): Promise<string[]> {
  const body = await readJsonSafe<{ enabledStrategies?: string[] }>(
    await apiRequest(request, 'GET', '/api/search/settings/global-search', { token }),
  )
  return Array.isArray(body?.enabledStrategies) && body.enabledStrategies.length ? body.enabledStrategies : ['fulltext', 'vector', 'tokens']
}

async function writeStrategies(request: APIRequestContext, token: string, strategies: string[]): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/search/settings/global-search', { token, data: { enabledStrategies: strategies } })
  expect(response.status()).toBe(200)
}

async function globalSearch(request: APIRequestContext, token: string, q: string): Promise<SearchResult[]> {
  const response = await apiRequest(request, 'GET', `/api/search/search/global?${new URLSearchParams({ q, limit: '50' })}`, { token })
  if (!response.ok()) return []
  const body = await readJsonSafe<{ results?: SearchResult[] }>(response)
  return Array.isArray(body?.results) ? body.results : []
}

/**
 * TC-PM-009: global search is limited to unrestricted staff
 * Global search cannot filter by building, so property_management search entities require
 * `property_management.buildings.manage_all`: an administrator finds both buildings, while
 * building-scoped manager A finds neither B's nor even their own building there.
 */
test.describe('TC-PM-009: global search and building access', () => {
  test('a building-scoped manager finds no property_management records in global search', async ({ request }) => {
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf().replace(/-/g, '')
    let managers: ManagerFixture | null = null
    let buildingA: string | null = null
    let buildingB: string | null = null
    let originalStrategies: string[] | null = null
    try {
      originalStrategies = await readStrategies(request, adminToken)
      await writeStrategies(request, adminToken, ['tokens'])
      managers = await createManagers(request, adminToken, stamp, 2, ['search.global'])
      const [managerA, managerB] = managers.users
      const nameA = `QAPMSRCHA${stamp}`
      const nameB = `QAPMSRCHB${stamp}`
      buildingA = await createBuilding(request, adminToken, { name: nameA, managerUserIds: [managerA.id] })
      buildingB = await createBuilding(request, adminToken, { name: nameB, managerUserIds: [managerB.id] })

      for (const [name, id] of [[nameA, buildingA], [nameB, buildingB]] as const) {
        await expect
          .poll(async () => (await globalSearch(request, adminToken, name)).some((result) => result.recordId === id), { timeout: 45_000 })
          .toBe(true)
      }

      for (const name of [nameA, nameB]) {
        const results = await globalSearch(request, managerA.token, name)
        expect(results.filter((result) => (result.entityId ?? '').startsWith(MODULE_PREFIX))).toEqual([])
      }

      const ownList = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/buildings?search=${nameA}`, { token: managerA.token }),
      )
      expect((ownList?.items ?? []).map((item) => item.id), 'the module list search still finds their own building').toEqual([buildingA])
    } finally {
      if (originalStrategies) await writeStrategies(request, adminToken, originalStrategies).catch(() => undefined)
      await deleteBuildingIfExists(request, adminToken, buildingA)
      await deleteBuildingIfExists(request, adminToken, buildingB)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
