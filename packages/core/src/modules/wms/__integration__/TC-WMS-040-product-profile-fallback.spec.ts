import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture, ensureRoleFeatures, postAction } from './helpers/wmsFixtures'
import { fillCombobox, waitForInventoryMutationScope } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * TC-WMS-040: Receive and reserve honor a product-level inventory profile
 * when the variant has no profile row of its own.
 */
test('TC-WMS-040: product-level profile drives lot tracking on receive and FEFO on reserve', async ({ page, request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(adminToken)
  const suffix = randomUUID().slice(0, 8)
  const variantSku = `TCW40-V-${suffix}`
  const warehouseName = `TC-WMS-040 Warehouse ${suffix}`
  const locationCode = `TCW40-BIN-${suffix}`
  const scoped = { organizationId: scope.organizationId, tenantId: scope.tenantId }

  const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
    'wms.view',
    'wms.manage_warehouses',
    'wms.manage_locations',
    'wms.manage_inventory',
    'wms.manage_reservations',
    'wms.adjust_inventory',
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
    productId = await createProductFixture(request, adminToken, { title: `TC-WMS-040 ${suffix}`, sku: `TCW40-P-${suffix}` })
    const variantId = await createVariantFixture(request, adminToken, { productId, name: variantSku, sku: variantSku })
    warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
      ...scoped,
      name: warehouseName,
      code: `TCW40-WH-${suffix}`,
      isActive: true,
      timezone: 'UTC',
    })
    locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
      ...scoped,
      warehouseId,
      code: locationCode,
      type: 'bin',
      isActive: true,
    })
    profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
      ...scoped,
      catalogProductId: productId,
      defaultUom: 'pc',
      defaultStrategy: 'fefo',
      trackLot: true,
      trackExpiration: true,
    })
    const lotBase = { ...scoped, catalogVariantId: variantId, sku: variantSku }
    lateLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
      ...lotBase,
      lotNumber: `TCW40-LATE-${suffix}`,
      expiresAt: daysFromNow(400),
    })
    earlyLotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
      ...lotBase,
      lotNumber: `TCW40-EARLY-${suffix}`,
      expiresAt: daysFromNow(100),
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
    const untrackedReceipt = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/wms/inventory/receive'),
    )
    await receiveDialog.getByRole('button', { name: 'Receive', exact: true }).click()
    expect((await untrackedReceipt).status()).toBe(422)
    await expect(page.getByText('Lot number is required for this variant.').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('lot_required', { exact: true })).toHaveCount(0)

    const receiveBase = {
      ...scoped,
      warehouseId,
      locationId,
      catalogVariantId: variantId,
      quantity: 5,
      referenceType: 'manual',
      performedBy: scope.userId,
    }
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
      ...scoped,
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
        data: { ...scoped, reservationId, reason: 'TC-WMS-040 cleanup' },
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
