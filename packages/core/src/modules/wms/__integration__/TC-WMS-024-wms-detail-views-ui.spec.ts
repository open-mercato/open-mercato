import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  postAction,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

test.describe('TC-WMS-024: WMS detail views — UI smoke', () => {
  test('loads SKU, location, and lot detail routes', async ({ page, request }) => {
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
      [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.adjust_inventory',
        'wms.cycle_count',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let lotId: string | null = null
    let profileId: string | null = null
    const variantSku = `TCW24-UIV-${suffix}`
    const locationCode = `UI-BIN-${suffix}`
    const lotNumber = `UI-LOT-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-024 UI ${suffix}`,
        sku: `TCW24-UI-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-024 UI Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-024 Warehouse ${suffix}`,
        code: `TCW24W${suffix}`,
        city: 'Gdansk',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: locationCode,
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

      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: variantSku,
        lotNumber,
        status: 'available',
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        lotId,
        delta: 5,
        reason: 'UI detail seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      await login(page, 'admin')

      await page.goto(`/backend/wms/sku/${encodeURIComponent(variantId)}`)
      await expect(page.getByRole('heading', { level: 1, name: variantSku })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Stock distribution/i })).toBeVisible()

      await page.goto(`/backend/wms/location/${encodeURIComponent(locationId)}`)
      await expect(page.getByRole('heading', { level: 1, name: locationCode })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Recent activity/i })).toBeVisible()

      await page.goto(`/backend/wms/lot/${encodeURIComponent(lotId)}`)
      await expect(page.getByRole('heading', { level: 1, name: lotNumber })).toBeVisible()
      await expect(page.getByText(/Loading lot view/i)).toHaveCount(0, { timeout: 30_000 })
      await expect(page.getByRole('heading', { name: /Where this lot lives/i })).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('navigates from inventory console links to detail pages', async ({ page, request }) => {
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
    const variantSku = `TCW24-NAV-${suffix}`
    const locationCode = `NAV-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-024 Nav ${suffix}`,
        sku: `TCW24-NAVP-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-024 Nav Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-024 Nav Warehouse ${suffix}`,
        code: `TCW24NW${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: locationCode,
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

      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: variantSku,
        lotNumber: `NAV-LOT-${suffix}`,
        status: 'available',
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        lotId,
        delta: 4,
        reason: 'Console nav seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      await login(page, 'admin')
      await page.goto('/backend/wms/inventory')

      const balanceRow = page.getByRole('row').filter({ hasText: variantSku }).first()
      await expect(balanceRow).toBeVisible({ timeout: 15_000 })

      await balanceRow.getByRole('link').filter({ hasText: variantSku }).click()
      await expect(page).toHaveURL(new RegExp(`/backend/wms/sku/${variantId}`))
      await expect(page.getByRole('heading', { level: 1, name: variantSku })).toBeVisible()

      await page.goto('/backend/wms/inventory')
      await expect(balanceRow).toBeVisible({ timeout: 15_000 })
      await balanceRow
        .locator(`a[href="/backend/wms/location/${locationId}"]`)
        .click()
      await expect(page).toHaveURL(new RegExp(`/backend/wms/location/${locationId}`))
      await expect(page.getByRole('heading', { level: 1, name: locationCode })).toBeVisible()

      await page.goto('/backend/wms/inventory')
      await expect(balanceRow).toBeVisible({ timeout: 15_000 })
      await balanceRow.locator(`a[href="/backend/wms/lot/${lotId}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/backend/wms/lot/${lotId}`))
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('prefills adjust dialog from location context and exports SKU distribution CSV', async ({
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
    let profileId: string | null = null
    const warehouseCode = `TCW24PFW${suffix}`
    const locationCode = `PF-${suffix}`
    const variantSku = `TCW24-PFV-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-024 Prefill ${suffix}`,
        sku: `TCW24-PFP-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-024 Prefill Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-024 Prefill Warehouse ${suffix}`,
        code: warehouseCode,
        city: 'Krakow',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: locationCode,
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

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: 3,
        reason: 'Prefill seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      await login(page, 'admin')
      await page.goto(`/backend/wms/location/${encodeURIComponent(locationId)}`)
      await expect(page.getByRole('heading', { level: 1, name: locationCode })).toBeVisible({
        timeout: 15_000,
      })

      await page.getByRole('button', { name: /Adjust stock/i }).first().click()
      const adjustDialog = page.getByRole('dialog').filter({ hasText: /Adjust inventory/i }).first()
      await expect(adjustDialog).toBeVisible()
      const locationInput = adjustDialog.getByPlaceholder('Select location')
      await expect(locationInput).toHaveValue(locationCode, { timeout: 10_000 })
      const warehouseInput = adjustDialog.getByPlaceholder('Select warehouse')
      await expect(warehouseInput).toHaveValue(`TC-WMS-024 Prefill Warehouse ${suffix}`, {
        timeout: 10_000,
      })
      await adjustDialog.getByRole('button', { name: /Cancel/i }).click()
      await expect(adjustDialog).toHaveCount(0)

      await page.goto(`/backend/wms/sku/${encodeURIComponent(variantId)}`)
      await expect(page.getByRole('heading', { name: /Stock distribution/i })).toBeVisible({
        timeout: 15_000,
      })

      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: /Export CSV/i }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toContain('distribution.csv')
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
