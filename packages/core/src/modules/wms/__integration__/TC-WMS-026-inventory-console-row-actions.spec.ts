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
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  fetchBalance,
  fetchReservations,
  postAction,
  setRoleFeaturesExact,
  toNumber,
} from './helpers/wmsFixtures'
import {
  ensureEnglishLocale,
  inventoryConsoleSection,
  openInventoryConsoleRowAction,
  submitInventoryDialog,
  waitForInventoryMutationScope,
  WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES,
  WMS_INVENTORY_ROW_ACTION_LABELS,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog', 'sales'],
}

type BalanceListResponse = {
  items?: Array<{
    location_id?: string | null
    catalog_variant_id?: string | null
    quantity_on_hand?: string | number | null
    quantity_available?: number | null
  }>
}

async function fetchBalanceAtLocation(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  query: {
    warehouseId: string
    locationId: string
    catalogVariantId: string
  },
) {
  const params = new URLSearchParams({
    page: '1',
    pageSize: '20',
    warehouseId: query.warehouseId,
    locationId: query.locationId,
    catalogVariantId: query.catalogVariantId,
  })

  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/balances?${params.toString()}`,
    { token },
  )
  expect(response.ok(), `Failed GET balances: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<BalanceListResponse>(response)
  return body?.items?.[0] ?? null
}

test.describe('TC-WMS-026: Inventory console row actions', () => {
  test('moves stock from balances row action and updates location buckets', async ({
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
      [...WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let fromLocationId: string | null = null
    let toLocationId: string | null = null
    let profileId: string | null = null

    const warehouseName = `TC-WMS-026 Move WH ${suffix}`
    const fromLocationCode = `FROM-${suffix}`
    const toLocationCode = `TO-${suffix}`
    const variantSku = `TCW26-M-${suffix}`
    const moveQty = 3
    const seedQty = 10

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-026 Move ${suffix}`,
        sku: `TCW26-MP-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-026 Move Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: `TCW26W${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      fromLocationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: fromLocationCode,
        type: 'bin',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      toLocationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: toLocationCode,
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
        locationId: fromLocationId,
        catalogVariantId: variantId,
        delta: seedQty,
        reason: 'TC-WMS-026 move seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      await expect
        .poll(
          async () => {
            const balance = await fetchBalanceAtLocation(request, adminToken, {
              warehouseId: warehouseId!,
              locationId: fromLocationId!,
              catalogVariantId: variantId,
            })
            return toNumber(balance?.quantity_available ?? 0)
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0)

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)
      await expect(
        inventoryConsoleSection(page, 'balances').getByRole('heading', {
          level: 2,
          name: /Inventory balances|Stany magazynowe/i,
        }),
      ).toBeVisible({ timeout: 15_000 })

      await openInventoryConsoleRowAction(
        page,
        'balances',
        variantSku,
        WMS_INVENTORY_ROW_ACTION_LABELS.move,
        { extraRowText: fromLocationCode, search: false },
      )

      const moveDialog = page.getByRole('dialog').filter({ hasText: /Move inventory/i }).first()
      await expect(moveDialog).toBeVisible()
      await expect(moveDialog.getByPlaceholder('Select source location')).toHaveValue(fromLocationCode)
      await expect(moveDialog.getByPlaceholder('Select warehouse')).toHaveValue(warehouseName)
      await moveDialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(moveDialog).toHaveCount(0)

      await postAction(request, adminToken, '/api/wms/inventory/move', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        fromLocationId,
        toLocationId,
        catalogVariantId: variantId,
        quantity: moveQty,
        reason: 'Transfer',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      await page.reload()
      await waitForInventoryMutationScope(page)

      const fromBalance = await fetchBalanceAtLocation(request, adminToken, {
        warehouseId,
        locationId: fromLocationId,
        catalogVariantId: variantId,
      })
      expect(toNumber(fromBalance?.quantity_on_hand)).toBe(seedQty - moveQty)

      const toBalance = await fetchBalanceAtLocation(request, adminToken, {
        warehouseId,
        locationId: toLocationId,
        catalogVariantId: variantId,
      })
      expect(toNumber(toBalance?.quantity_on_hand)).toBe(moveQty)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', toLocationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', fromLocationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('releases an active reservation from the reservations table', async ({ page, request }) => {
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
      [...WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    let orderId: string | null = null
    let reservationId: string | null = null

    const variantSku = `TCW26-R-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-026 Release ${suffix}`,
        sku: `TCW26-RP-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-026 Release Variant ${suffix}`,
        sku: variantSku,
      })

      orderId = await createSalesOrderFixture(request, adminToken)

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-026 Release WH ${suffix}`,
        code: `TCW26RW${suffix}`,
        isActive: true,
        timezone: 'UTC',
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `REL-${suffix}`,
        type: 'bin',
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pc',
        defaultStrategy: 'fifo',
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: 8,
        reason: 'TC-WMS-026 release seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const reserveBody = await postAction<{ reservationId: string }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 4,
          sourceType: 'order',
          sourceId: orderId,
        },
      )
      reservationId = reserveBody.reservationId

      await expect
        .poll(
          async () => {
            const reservations = await fetchReservations(request, adminToken, {
              warehouseId: warehouseId!,
              catalogVariantId: variantId,
              sourceId: orderId!,
            })
            return reservations.find(
              (item) => item.id === reservationId && item.status === 'active',
            )
          },
          { timeout: 15_000 },
        )
        .not.toBeNull()

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/inventory')
      await waitForInventoryMutationScope(page)
      await expect(
        inventoryConsoleSection(page, 'reservations').getByRole('heading', {
          level: 2,
          name: /Inventory reservations|Rezerwacje zapasu/i,
        }),
      ).toBeVisible({ timeout: 15_000 })

      await openInventoryConsoleRowAction(
        page,
        'reservations',
        variantSku,
        WMS_INVENTORY_ROW_ACTION_LABELS.release,
        { search: false },
      )

      const releaseDialog = page
        .getByRole('dialog')
        .filter({ hasText: /Release reservation/i })
        .first()
      await expect(releaseDialog).toBeVisible()
      await expect(releaseDialog.getByRole('combobox').first()).toContainText('Manual release', {
        timeout: 10_000,
      })

      const releaseResponse = await submitInventoryDialog(page, releaseDialog, {
        submitTestId: 'wms-inventory-release-submit',
        apiPath: '/api/wms/inventory/release',
        timeoutMs: 20_000,
      })
      expect(releaseResponse.ok()).toBeTruthy()

      await expect(page.getByText('Reservation released').first()).toBeVisible({
        timeout: 10_000,
      })
      await expect(releaseDialog).toHaveCount(0)

      const reservations = await fetchReservations(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        sourceId: orderId,
      })
      const released = reservations.find((item) => item.id === reservationId)
      expect(released?.status).toBe('released')

      const balance = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balance?.quantity_reserved)).toBe(0)
      expect(balance?.quantity_available).toBe(8)
    } finally {
      if (reservationId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/release', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            reason: 'TC-WMS-026 cleanup',
          },
        }).catch(() => undefined)
      }

      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('hides move and release row actions without mutation features', async ({ page, request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const viewOnlyFeatures = [
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_locations',
      'wms.manage_inventory',
    ]

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
    let orderId: string | null = null
    let reservationId: string | null = null
    let restoreViewOnlyAcl: (() => Promise<void>) | null = null

    const variantSku = `TCW26-RBAC-${suffix}`
    const locationCode = `RBAC-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-026 RBAC ${suffix}`,
        sku: `TCW26-RBAC-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-026 RBAC Variant ${suffix}`,
        sku: variantSku,
      })

      orderId = await createSalesOrderFixture(request, adminToken)

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-026 RBAC WH ${suffix}`,
        code: `TCW26RB${suffix}`,
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
        catalogVariantId: variantId,
        defaultUom: 'pc',
        defaultStrategy: 'fifo',
      })

      await postAction(request, adminToken, '/api/wms/inventory/adjust', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        locationId,
        catalogVariantId: variantId,
        delta: 6,
        reason: 'TC-WMS-026 RBAC seed',
        referenceType: 'manual',
        referenceId: randomUUID(),
        performedBy: scope.userId,
      })

      const reserveBody = await postAction<{ reservationId: string }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 2,
          sourceType: 'order',
          sourceId: orderId,
        },
      )
      reservationId = reserveBody.reservationId

      restoreViewOnlyAcl = await setRoleFeaturesExact(
        request,
        superadminToken,
        scope.tenantId,
        'admin',
        viewOnlyFeatures,
      )

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/inventory')
      await expect(
        inventoryConsoleSection(page, 'balances').getByRole('heading', {
          level: 2,
          name: /Inventory balances|Stany magazynowe/i,
        }),
      ).toBeVisible({ timeout: 15_000 })

      const balanceRow = inventoryConsoleSection(page, 'balances')
        .getByRole('row')
        .filter({ hasText: variantSku })
        .filter({ hasText: locationCode })
        .first()
      await expect(balanceRow).toBeVisible({ timeout: 15_000 })
      await expect(
        balanceRow.getByRole('button', { name: WMS_INVENTORY_ROW_ACTION_LABELS.openActions }),
      ).toHaveCount(0)

      const reservationRow = inventoryConsoleSection(page, 'reservations')
        .getByRole('row')
        .filter({ hasText: variantSku })
        .first()
      await expect(reservationRow).toBeVisible({ timeout: 15_000 })
      await expect(
        reservationRow.getByRole('button', { name: WMS_INVENTORY_ROW_ACTION_LABELS.openActions }),
      ).toHaveCount(0)
    } finally {
      if (restoreViewOnlyAcl) {
        await restoreViewOnlyAcl()
      }

      if (reservationId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/release', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            reason: 'TC-WMS-026 RBAC cleanup',
          },
        }).catch(() => undefined)
      }

      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
