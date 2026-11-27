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
import { createCrudFixture, ensureRoleFeatures, postAction } from './helpers/wmsFixtures'
import { fillCombobox, waitForInventoryMutationScope } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

const DAY_MS = 24 * 60 * 60 * 1000

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString()
}

/**
 * TC-WMS-040: Receive and reserve honor a product-level inventory profile
 * when the variant has no profile row of its own.
 */
test.describe('TC-WMS-040: Product-level inventory profile drives lot tracking and FEFO', () => {
  test('rejects an untracked receipt and allocates the earliest-expiring lot first', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_locations',
      'wms.manage_inventory',
      'wms.manage_reservations',
      'wms.receive_inventory',
    ])

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    let lateLotId: string | null = null
    let earlyLotId: string | null = null
    let reservationId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-040 Product ${suffix}`,
        sku: `TCW40-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-040 Variant ${suffix}`,
        sku: `TCW40-V-${suffix}`,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-040 Warehouse ${suffix}`,
        code: `TCW40-WH-${suffix}`,
        isActive: true,
        timezone: 'UTC',
      })
      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `TCW40-BIN-${suffix}`,
        type: 'bin',
        isActive: true,
      })
      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        defaultUom: 'pc',
        defaultStrategy: 'fefo',
        trackLot: true,
        trackExpiration: true,
      })
      lateLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCW40-V-${suffix}`,
        lotNumber: `TCW40-LATE-${suffix}`,
        expiresAt: daysFromNow(400),
      })
      earlyLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCW40-V-${suffix}`,
        lotNumber: `TCW40-EARLY-${suffix}`,
        expiresAt: daysFromNow(100),
      })

      const receiveBase = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        quantity: 5,
        referenceType: 'manual',
        performedBy: scope.userId,
      }

      const untracked = await apiRequest(request, 'POST', '/api/wms/inventory/receive', {
        token: adminToken,
        data: { ...receiveBase, referenceId: randomUUID() },
      })
      expect(untracked.status()).toBe(422)
      expect((await readJsonSafe<{ error?: string }>(untracked))?.error).toBe('lot_required')

      await postAction(request, adminToken, '/api/wms/inventory/receive', {
        ...receiveBase,
        lotId: lateLotId,
        referenceId: randomUUID(),
        receivedAt: daysFromNow(-10),
      })
      await postAction(request, adminToken, '/api/wms/inventory/receive', {
        ...receiveBase,
        lotId: earlyLotId,
        referenceId: randomUUID(),
        receivedAt: daysFromNow(-1),
      })

      const reserved = await postAction<{
        reservationId: string
        allocatedBuckets: Array<{ lotId: string | null; quantity: string }>
      }>(request, adminToken, '/api/wms/inventory/reserve', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        catalogVariantId: variantId,
        quantity: 3,
        sourceType: 'manual',
        sourceId: randomUUID(),
      })
      reservationId = reserved.reservationId
      expect(reserved.allocatedBuckets).toEqual([expect.objectContaining({ lotId: earlyLotId, quantity: '3' })])
    } finally {
      if (reservationId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/release', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            reason: 'TC-WMS-040 cleanup',
          },
        }).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', earlyLotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lateLotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('shows the translated lot requirement when the receive dialog submits without a lot', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const variantSku = `TCW40-UIV-${suffix}`
    const warehouseName = `TC-WMS-040 UI Warehouse ${suffix}`
    const locationCode = `TCW40-UIBIN-${suffix}`

    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_locations',
      'wms.manage_inventory',
      'wms.adjust_inventory',
      'wms.receive_inventory',
    ])

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-040 UI Product ${suffix}`,
        sku: `TCW40-UIP-${suffix}`,
      })
      await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-040 UI Variant ${suffix}`,
        sku: variantSku,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: `TCW40-UIWH-${suffix}`,
        isActive: true,
        timezone: 'UTC',
      })
      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: locationCode,
        type: 'bin',
        isActive: true,
      })
      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        defaultUom: 'pc',
        defaultStrategy: 'fifo',
        trackLot: true,
      })

      await login(page, 'admin')
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)

      await page.getByRole('button', { name: 'Receive stock (no ASN)' }).click()
      const receiveDialog = page.getByRole('dialog').filter({ hasText: /Receive inventory \(no ASN\)/i }).first()
      await expect(receiveDialog).toBeVisible()

      await fillCombobox(page, 'Search variant or SKU', variantSku, {
        scope: receiveDialog,
        suggestionsApiPath: '/api/catalog/variants',
      })
      await fillCombobox(page, 'Select warehouse', warehouseName, {
        scope: receiveDialog,
        suggestionsApiPath: '/api/wms/warehouses',
        waitForEnabledPlaceholder: 'Select location',
      })
      await fillCombobox(page, 'Select location', locationCode, {
        scope: receiveDialog,
        suggestionsApiPath: '/api/wms/locations',
      })

      const receiveResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().includes('/api/wms/inventory/receive'),
      )
      await receiveDialog.getByRole('button', { name: 'Receive', exact: true }).click()
      expect((await receiveResponse).status()).toBe(422)

      await expect(page.getByText('Lot number is required for this variant.').first()).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('lot_required', { exact: true })).toHaveCount(0)
      await expect(receiveDialog).toBeVisible()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
