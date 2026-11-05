import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  postAction,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
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
  expiryLots?: Array<{
    id?: string
    lotNumber?: string
    sku?: string
    expiresAt?: string
    availableQuantity?: number
    category?: 'expiringSoon' | 'pastDue'
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
    expect(body?.kpis?.length).toBe(6)
    expect(Array.isArray(body?.monthlyTrends)).toBe(true)
    expect(Array.isArray(body?.recentActivity)).toBe(true)
    expect(Array.isArray(body?.expiryLots)).toBe(true)

    const todaysMoves = body?.kpis?.find((kpi) => kpi.id === 'todaysMoves')
    expect(todaysMoves).toBeTruthy()
    expect(typeof todaysMoves?.count).toBe('number')
    expect(
      todaysMoves?.deltaSinceYesterday === null || typeof todaysMoves?.deltaSinceYesterday === 'number',
    ).toBeTruthy()

    const pastDue = body?.kpis?.find((kpi) => kpi.id === 'pastDue')
    expect(pastDue).toBeTruthy()
    expect(typeof pastDue?.count).toBe('number')
    expect(Array.isArray(pastDue?.sparkline)).toBe(true)
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

  test('counts past-due lots with on-hand stock in dashboard KPIs', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.adjust_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let lotId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-DASHBOARD Past Due ${suffix}`,
        sku: `TCDPD-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-DASHBOARD Past Due Variant ${suffix}`,
        sku: `TCDPD-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-DASHBOARD Warehouse ${suffix}`,
        code: `TCDPDW${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `BIN-${suffix}`,
        type: 'bin',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })

      const expiredAt = new Date()
      expiredAt.setUTCDate(expiredAt.getUTCDate() - 3)

      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCDPD-V-${suffix}`,
        lotNumber: `PAST-DUE-${suffix}`,
        status: 'available',
        expiresAt: expiredAt.toISOString(),
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        lotId,
        delta: 2,
        reason: 'Opening balance',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const dashboardResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/dashboard/operational?warehouseId=${encodeURIComponent(warehouseId)}`,
        { token: adminToken },
      )
      expect(dashboardResponse.ok(), `Expected 200, got ${dashboardResponse.status()}`).toBeTruthy()
      const dashboardBody = await readJsonSafe<OperationalDashboardResponse>(dashboardResponse)
      const pastDue = dashboardBody?.kpis?.find((kpi) => kpi.id === 'pastDue')
      expect(pastDue?.count).toBeGreaterThanOrEqual(1)

      const pastDueLotRow = dashboardBody?.expiryLots?.find(
        (lot) => lot.id === lotId && lot.category === 'pastDue',
      )
      expect(pastDueLotRow).toBeTruthy()
      expect(pastDueLotRow?.availableQuantity).toBe(2)

      const lotsWithWarehouseResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/lots?expiryWindow=pastDue&warehouseId=${encodeURIComponent(warehouseId)}&page=1&pageSize=25`,
        { token: adminToken },
      )
      expect(
        lotsWithWarehouseResponse.ok(),
        `Expected 200 from lots API, got ${lotsWithWarehouseResponse.status()}`,
      ).toBeTruthy()
      const lotsWithWarehouseBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(
        lotsWithWarehouseResponse,
      )
      expect(lotsWithWarehouseBody?.items?.some((item) => item.id === lotId)).toBeTruthy()

      const lotsTenantResponse = await apiRequest(
        request,
        'GET',
        '/api/wms/lots?expiryWindow=pastDue&page=1&pageSize=25',
        { token: adminToken },
      )
      expect(
        lotsTenantResponse.ok(),
        `Expected 200 from tenant-scoped lots API, got ${lotsTenantResponse.status()}`,
      ).toBeTruthy()
      const lotsTenantBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(lotsTenantResponse)
      expect(lotsTenantBody?.items?.some((item) => item.id === lotId)).toBeTruthy()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
