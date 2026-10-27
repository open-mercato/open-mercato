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
import { WMS_INVENTORY_MUTATION_FEATURES } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

const KPI_TITLES = [
  'Low stock',
  'Reorder critical',
  'Expiring soon',
  'Past due',
  'Aging reservations',
  "Today's moves",
] as const

/**
 * UI smoke for /backend/wms operational dashboard.
 * Complements API coverage in TC-WMS-DASHBOARD-001.spec.ts
 */
test.describe('TC-WMS-DASHBOARD-UI-001: Operational dashboard UI', () => {
  test('renders KPI cards, warehouse filter, and quick-action links', async ({ page }) => {
    test.slow()

    await login(page, 'admin')
    await page.goto('/backend/wms')

    await expect(page.getByRole('heading', { level: 1, name: 'Operational dashboard' })).toBeVisible({
      timeout: 15_000,
    })

    for (const title of KPI_TITLES) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
    }

    await expect(page.getByRole('combobox').first()).toBeVisible()
    await expect(page.getByText('All warehouses').first()).toBeVisible()

    await expect(page.getByRole('link', { name: 'View low stock' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'View past due' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'View ledger' }).first()).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Monthly trends' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Expiry watch' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open inventory console' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh' }).first()).toBeVisible()
  })

  test('filters dashboard KPIs by warehouse after selecting a fixture warehouse', async ({
    page,
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...WMS_INVENTORY_MUTATION_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let lotId: string | null = null
    let profileId: string | null = null
    const warehouseName = `TC-WMS-DASH-UI Warehouse ${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-DASH-UI ${suffix}`,
        sku: `TCDUI-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-DASH-UI Variant ${suffix}`,
        sku: `TCDUI-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: `TCDUIW${suffix}`,
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
        sku: `TCDUI-V-${suffix}`,
        lotNumber: `PAST-DUE-UI-${suffix}`,
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
        reason: 'Past due dashboard UI seed',
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
      const dashboardBody = await readJsonSafe<{
        kpis?: Array<{ id?: string; count?: number }>
      }>(dashboardResponse)
      const pastDueKpi = dashboardBody?.kpis?.find((kpi) => kpi.id === 'pastDue')
      expect(pastDueKpi?.count).toBeGreaterThanOrEqual(1)

      await login(page, 'admin')
      await page.goto('/backend/wms')

      await expect(page.getByRole('heading', { level: 1, name: 'Operational dashboard' })).toBeVisible({
        timeout: 15_000,
      })

      await page.getByRole('combobox').first().click()
      await page.getByRole('option', { name: warehouseName }).click()

      await expect(page.getByText(warehouseName).first()).toBeVisible()
      await expect(page.getByRole('link', { name: 'View past due' }).first()).toBeVisible()

      const pastDueCard = page
        .locator('section')
        .filter({ hasText: 'Expired lots with on-hand stock' })
        .last()
      await expect.poll(
        async () => {
          const cardText = await pastDueCard.textContent()
          const match = cardText?.match(/(\d+)\s+lots/)
          return match ? Number.parseInt(match[1], 10) : 0
        },
        { timeout: 15_000 },
      ).toBeGreaterThanOrEqual(1)
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
