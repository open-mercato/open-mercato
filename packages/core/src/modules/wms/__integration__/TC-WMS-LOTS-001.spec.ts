import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
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
  kpis?: Array<{ id?: string; count?: number }>
}

test.describe('TC-WMS-LOTS-001 past-due lots list', () => {
  test('loads past-due lots page with table and search', async ({ page, request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const lotNumber = `PAST-UI-${suffix}`

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
        title: `TC-WMS-LOTS Past Due ${suffix}`,
        sku: `TCLPD-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-LOTS Past Due Variant ${suffix}`,
        sku: `TCLPD-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-LOTS Warehouse ${suffix}`,
        code: `TCLPDW${suffix}`,
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
      expiredAt.setUTCDate(expiredAt.getUTCDate() - 2)

      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCLPD-V-${suffix}`,
        lotNumber,
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
        delta: 1,
        reason: 'Opening balance',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const lotsApiResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/lots?expiryWindow=pastDue&page=1&pageSize=25`,
        { token: adminToken },
      )
      expect(lotsApiResponse.ok(), `Expected 200 from lots API, got ${lotsApiResponse.status()}`).toBeTruthy()
      const lotsBody = await readJsonSafe<{ items?: Array<{ id?: string; lot_number?: string }> }>(
        lotsApiResponse,
      )
      expect(lotsBody?.items?.some((item) => item.id === lotId)).toBeTruthy()

      const dashboardResponse = await apiRequest(
        request,
        'GET',
        '/api/wms/dashboard/operational',
        { token: adminToken },
      )
      expect(dashboardResponse.ok()).toBeTruthy()
      const dashboardBody = await readJsonSafe<OperationalDashboardResponse>(dashboardResponse)
      const pastDueKpi = dashboardBody?.kpis?.find((kpi) => kpi.id === 'pastDue')
      expect(pastDueKpi?.count).toBeGreaterThanOrEqual(1)

      await login(page, 'admin')
      await page.goto('/backend/wms/lots?expiryWindow=pastDue')

      await expect(page.getByRole('heading', { name: /past.?due lots/i })).toBeVisible()
      await expect(page.getByPlaceholder(/search lots/i)).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /lot number/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /^sku$/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /expires/i })).toBeVisible()
      await expect(page.getByRole('link', { name: lotNumber })).toBeVisible()

      await page.getByPlaceholder(/search lots/i).fill(lotNumber)
      await expect(page.getByRole('link', { name: lotNumber })).toBeVisible()
      await page.getByPlaceholder(/search lots/i).fill(`missing-${suffix}`)
      await expect(page.getByTestId('search-empty-results')).toBeVisible()
      await expect(page.getByText(/No results found/i)).toBeVisible()
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
