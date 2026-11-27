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
  fetchReservations,
  postAction,
} from './helpers/wmsFixtures'
import {
  ensureEnglishLocale,
  expectDialogHasNoFieldErrors,
  fillCombobox,
  inventoryOperationsSection,
  waitForInventoryMutationScope,
  WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type ReserveResponse = {
  allocatedBuckets?: Array<{ locationId: string; lotId: string | null; quantity: string }>
}

test.describe('TC-WMS-10090: Reserve dialog optional lot', () => {
  test('reserves a lot-tracked variant without a lot and lets FEFO pick the lot', async ({ page, request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const scopeIds = { organizationId: scope.organizationId, tenantId: scope.tenantId }
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    const lotIds: string[] = []
    const warehouseName = `TC-WMS-10090 Warehouse ${suffix}`
    const variantSku = `TCW10090-V-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-10090 Product ${suffix}`,
        sku: `TCW10090-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-10090 Variant ${suffix}`,
        sku: variantSku,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        ...scopeIds,
        name: warehouseName,
        code: `TCW90${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })
      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        ...scopeIds,
        warehouseId,
        code: `BIN-${suffix}`,
        type: 'bin',
        isActive: true,
      })
      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        ...scopeIds,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fefo',
        trackLot: true,
        trackExpiration: true,
      })
      const lotFixtures = [
        { number: `LOT-LATE-${suffix}`, expiresAt: '2099-12-31T12:00:00.000Z' },
        { number: `LOT-EARLY-${suffix}`, expiresAt: '2099-06-30T12:00:00.000Z' },
      ]
      for (const lot of lotFixtures) {
        const lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
          ...scopeIds,
          catalogVariantId: variantId,
          sku: variantSku,
          lotNumber: lot.number,
          expiresAt: lot.expiresAt,
        })
        lotIds.push(lotId)
        await postAction(request, adminToken, '/api/wms/inventory/adjust', {
          ...scopeIds,
          warehouseId,
          locationId,
          catalogVariantId: variantId,
          lotId,
          delta: 6,
          reason: 'TC-WMS-10090 seed',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        })
      }
      const earliestExpiringLotId = lotIds[1]

      await ensureEnglishLocale(page)
      await login(page, 'admin')
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)

      await inventoryOperationsSection(page)
        .getByRole('button', { name: 'Reserve', exact: true })
        .click()
      const dialog = page.getByRole('dialog').filter({ hasText: 'Reserve inventory' })
      await expect(dialog).toBeVisible()

      await fillCombobox(page, 'Select warehouse…', warehouseName, {
        scope: dialog,
        suggestionsApiPath: '/api/wms/warehouses',
      })
      const profileResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/wms/inventory-profiles') &&
          response.url().includes(variantId),
      )
      await fillCombobox(page, 'Search SKU or name…', variantSku, {
        scope: dialog,
        suggestionsApiPath: '/api/catalog/variants',
      })
      await profileResponse

      await expect(dialog.getByPlaceholder('Any lot (system selects)…', { exact: true })).toHaveValue('')
      await expect(dialog.getByText('Lot (optional)', { exact: true })).toBeVisible()

      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/api/wms/inventory/reserve'),
      )
      await dialog.getByRole('button', { name: /^Reserve/ }).click()
      const response = await responsePromise
      await expectDialogHasNoFieldErrors(dialog)
      expect(response.request().postDataJSON()).not.toHaveProperty('lotId')
      expect(response.status()).toBe(200)

      const body = (await response.json()) as ReserveResponse
      expect(body.allocatedBuckets).toEqual([
        expect.objectContaining({ locationId, lotId: earliestExpiringLotId }),
      ])
      await expect(page.getByText('Reservation created successfully.').first()).toBeVisible()
      await expect(dialog).toHaveCount(0)
    } finally {
      try {
        if (warehouseId) {
          const reservations = await fetchReservations(request, adminToken, {
            warehouseId,
            status: 'active',
          })
          for (const reservation of reservations) {
            await postAction(request, adminToken, '/api/wms/inventory/release', {
              ...scopeIds,
              reservationId: reservation.id,
              reason: 'TC-WMS-10090 cleanup',
            })
          }
        }
      } finally {
        try {
          await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
          for (const lotId of lotIds) {
            await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
          }
          await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
          await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
          await deleteCatalogProductIfExists(request, adminToken, productId)
        } finally {
          await restoreAdminAcl()
        }
      }
    }
  })
})
