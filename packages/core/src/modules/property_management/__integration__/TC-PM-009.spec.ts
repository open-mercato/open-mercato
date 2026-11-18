import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, deleteBuildingIfExists, stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'
import { cleanupLeaseSetup, createLease, createLeaseSetup, isoDayFromToday, type LeaseSetup } from './leaseFixtures'

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
  const body = await readJsonSafe<{ results?: SearchResult[] }>(response)
  expect(response.status(), `GET search/global?q=${q} → ${JSON.stringify(body)}`).toBe(200)
  return Array.isArray(body?.results) ? body.results : []
}

function moduleResults(results: SearchResult[]): SearchResult[] {
  return results.filter((result) => (result.entityId ?? '').startsWith(MODULE_PREFIX))
}

/**
 * TC-PM-009: global search is limited to unrestricted staff
 * Global search cannot filter by building, so property_management search entities require
 * `property_management.buildings.manage_all`: an administrator finds both buildings and the unit and
 * lease in building B, while building-scoped manager A finds none of them — not even their own
 * building. Every search must answer 200, so an error never passes as "nothing found".
 */
test.describe('TC-PM-009: global search and building access', () => {
  test('a building-scoped manager finds no property_management records in global search', async ({ request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf().replace(/-/g, '')
    let managers: ManagerFixture | null = null
    let buildingA: string | null = null
    let leaseSetup: LeaseSetup | null = null
    let originalStrategies: string[] | null = null
    try {
      originalStrategies = await readStrategies(request, adminToken)
      await writeStrategies(request, adminToken, ['tokens'])
      managers = await createManagers(request, adminToken, stamp, 2, ['search.global'])
      const [managerA, managerB] = managers.users
      const nameA = `QAPMSRCHA${stamp}`
      const nameB = `QAPMSRCHB${stamp}`
      const unitNameB = `QAPMSRCHU${stamp}`
      buildingA = await createBuilding(request, adminToken, { name: nameA, managerUserIds: [managerA.id] })
      leaseSetup = await createLeaseSetup(request, adminToken, stamp, {
        managerUserIds: [managerB.id],
        buildingName: nameB,
        unitName: () => unitNameB,
      })
      const buildingB = leaseSetup.buildingId as string
      const [unitB] = leaseSetup.unitIds
      const leaseB = await createLease(request, adminToken, leaseSetup, {
        unitId: unitB,
        customerCompanyId: leaseSetup.companyIds[0],
        startsOn: isoDayFromToday(10),
        termMonths: 3,
      })

      const expected: Array<[string, string, string]> = [
        [nameA, buildingA, 'building A'],
        [nameB, buildingB, 'building B'],
        [unitNameB, unitB, 'the unit in building B'],
        [unitNameB, leaseB.id, 'the lease in building B'],
      ]
      for (const [query, id, label] of expected) {
        await expect
          .poll(async () => (await globalSearch(request, adminToken, query)).some((result) => result.recordId === id), {
            timeout: 45_000,
            message: `the administrator finds ${label}`,
          })
          .toBe(true)
      }

      for (const query of [nameA, nameB, unitNameB]) {
        expect(moduleResults(await globalSearch(request, managerA.token, query)), `manager A finds nothing for ${query}`).toEqual([])
      }

      const ownList = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/buildings?search=${nameA}`, { token: managerA.token }),
      )
      expect((ownList?.items ?? []).map((item) => item.id), 'the module list search still finds their own building').toEqual([buildingA])
    } finally {
      if (originalStrategies) await writeStrategies(request, adminToken, originalStrategies).catch(() => undefined)
      await deleteBuildingIfExists(request, adminToken, buildingA)
      await cleanupLeaseSetup(request, adminToken, leaseSetup)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
