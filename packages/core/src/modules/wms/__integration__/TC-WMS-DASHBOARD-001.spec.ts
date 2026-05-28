import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms'],
}

type OperationalDashboardResponse = {
  lastUpdatedAt?: string
  warehouseId?: string | null
  kpis?: Array<{
    id?: string
    count?: number
    deltaSinceYesterday?: number | null
    sparkline?: number[]
  }>
  monthlyTrends?: Array<{ month?: string; receive?: number; allocate?: number }>
  recentActivity?: Array<{ id?: string; movementType?: string }>
}

test.describe('TC-WMS-DASHBOARD-001 operational dashboard API', () => {
  test('returns dashboard payload for authenticated WMS viewers', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'GET', '/api/wms/dashboard/operational', { token })
    expect(response.ok(), `Expected 200 from dashboard API, got ${response.status()}`).toBeTruthy()

    const body = await readJsonSafe<OperationalDashboardResponse>(response)
    expect(typeof body?.lastUpdatedAt).toBe('string')
    expect(Array.isArray(body?.kpis)).toBe(true)
    expect(body?.kpis?.length).toBe(5)
    expect(Array.isArray(body?.monthlyTrends)).toBe(true)
    expect(Array.isArray(body?.recentActivity)).toBe(true)

    const todaysMoves = body?.kpis?.find((kpi) => kpi.id === 'todaysMoves')
    expect(todaysMoves).toBeTruthy()
    expect(typeof todaysMoves?.count).toBe('number')
    expect(
      todaysMoves?.deltaSinceYesterday === null || typeof todaysMoves?.deltaSinceYesterday === 'number',
    ).toBeTruthy()
  })

  test('rejects unauthenticated dashboard requests', async ({ request }) => {
    const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:3000'
    const response = await request.get(`${baseUrl}/api/wms/dashboard/operational`)
    expect(response.status()).toBe(401)
  })

  test('returns 404 for unknown warehouse filter ids', async ({ request }) => {
    const token = await getAuthToken(request)
    const unknownWarehouseId = randomUUID()
    const response = await apiRequest(
      request,
      'GET',
      `/api/wms/dashboard/operational?warehouseId=${encodeURIComponent(unknownWarehouseId)}`,
      { token },
    )
    expect(response.status()).toBe(404)
  })
})
