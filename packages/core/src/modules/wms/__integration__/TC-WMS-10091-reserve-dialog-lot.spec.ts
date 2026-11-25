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

/**
 * Regression coverage for #10091: picking a lot in the Reserve dialog must send the lot ID,
 * so the reservation is created against the selected lot instead of failing with a 400.
 */
test.describe('TC-WMS-10091: Reserve dialog lot selection', () => {
  test('reserves stock from the lot picked in the dialog', async ({ page, request }) => {
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
    const warehouseName = `TC-WMS-10091 Warehouse ${suffix}`
    const variantSku = `TCW10091-V-${suffix}`
    const lotNumber = `LOT-B-${suffix}`
    const lotLabel = `${lotNumber} · exp 2099-12-31`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-10091 Product ${suffix}`,
        sku: `TCW10091-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-10091 Variant ${suffix}`,
        sku: variantSku,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        ...scopeIds,
        name: warehouseName,
        code: `TCW91${suffix}`,
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
        { number: `LOT-A-${suffix}`, expiresAt: '2099-06-30T12:00:00.000Z' },
        { number: lotNumber, expiresAt: '2099-12-31T12:00:00.000Z' },
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
          reason: 'TC-WMS-10091 seed',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        })
      }
      const selectedLotId = lotIds[1]

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
      await fillCombobox(page, 'Search SKU or name…', variantSku, {
        scope: dialog,
        suggestionsApiPath: '/api/catalog/variants',
      })

      const lotInput = dialog.getByPlaceholder('Select lot…', { exact: true })
      await lotInput.click()
      await page.getByRole('option', { name: lotLabel, exact: true }).click()
      await lotInput.press('Tab')
      await expect(lotInput).toHaveValue(lotLabel)
      await expectDialogHasNoFieldErrors(dialog)

      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/api/wms/inventory/reserve'),
      )
      await dialog.getByRole('button', { name: /^Reserve/ }).click()
      const response = await responsePromise
      expect(response.request().postDataJSON()).toMatchObject({ lotId: selectedLotId })
      expect(response.status()).toBe(200)

      const body = (await response.json()) as ReserveResponse
      expect(body.allocatedBuckets).toEqual([
        expect.objectContaining({ locationId, lotId: selectedLotId }),
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
              reason: 'TC-WMS-10091 cleanup',
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
