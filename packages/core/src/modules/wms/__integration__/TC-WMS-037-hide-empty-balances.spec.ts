import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
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
  type InventoryBalanceListResponse,
} from './helpers/wmsFixtures'
import {
  ensureEnglishLocale,
  inventoryConsoleSection,
  WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type EmptiedBucketFixture = {
  variantId: string
  variantSku: string
  emptiedLocationId: string
  emptiedLocationCode: string
  stockedLocationId: string
  stockedLocationCode: string
}

type FixtureIds = {
  productId: string | null
  warehouseId: string | null
  emptiedLocationId: string | null
  stockedLocationId: string | null
  profileId: string | null
}

async function listVariantBalanceLocations(
  request: APIRequestContext,
  token: string,
  variantId: string,
  extra: Record<string, string> = {},
): Promise<string[]> {
  const params = new URLSearchParams({ catalogVariantId: variantId, page: '1', pageSize: '100', ...extra })
  const response = await apiRequest(request, 'GET', `/api/wms/inventory/balances?${params.toString()}`, { token })
  expect(response.ok(), `Failed GET balances: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<InventoryBalanceListResponse>(response)
  return (body?.items ?? []).map((item) => String(item.location_id ?? '')).sort()
}

async function createEmptiedBucket(
  request: APIRequestContext,
  token: string,
  ids: FixtureIds,
  label: string,
): Promise<EmptiedBucketFixture> {
  const scope = getTokenScope(token)
  const suffix = randomUUID().slice(0, 8)
  const variantSku = `TCW37-${label}-${suffix}`
  const emptiedLocationCode = `EMPTY-${suffix}`
  const stockedLocationCode = `STOCK-${suffix}`

  ids.productId = await createProductFixture(request, token, {
    title: `TC-WMS-037 ${label} ${suffix}`,
    sku: `TCW37-P-${label}-${suffix}`,
  })
  const variantId = await createVariantFixture(request, token, {
    productId: ids.productId,
    name: `TC-WMS-037 ${label} Variant ${suffix}`,
    sku: variantSku,
  })
  ids.warehouseId = await createCrudFixture(request, token, '/api/wms/warehouses', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    name: `TC-WMS-037 ${label} WH ${suffix}`,
    code: `TCW37${label}${suffix}`,
    isActive: true,
    timezone: 'UTC',
  })
  ids.emptiedLocationId = await createCrudFixture(request, token, '/api/wms/locations', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId: ids.warehouseId,
    code: emptiedLocationCode,
    type: 'bin',
    isActive: true,
  })
  ids.stockedLocationId = await createCrudFixture(request, token, '/api/wms/locations', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId: ids.warehouseId,
    code: stockedLocationCode,
    type: 'bin',
    isActive: true,
  })
  ids.profileId = await createCrudFixture(request, token, '/api/wms/inventory-profiles', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    catalogProductId: ids.productId,
    catalogVariantId: variantId,
    defaultUom: 'pc',
    defaultStrategy: 'fifo',
  })

  await postAction(request, token, '/api/wms/inventory/adjust', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId: ids.warehouseId,
    locationId: ids.emptiedLocationId,
    catalogVariantId: variantId,
    delta: 4,
    reason: 'TC-WMS-037 seed',
    referenceType: 'manual',
    referenceId: randomUUID(),
    performedBy: scope.userId,
  })
  await postAction(request, token, '/api/wms/inventory/move', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId: ids.warehouseId,
    fromLocationId: ids.emptiedLocationId,
    toLocationId: ids.stockedLocationId,
    catalogVariantId: variantId,
    quantity: 4,
    reason: 'Transfer',
    referenceType: 'manual',
    referenceId: randomUUID(),
    performedBy: scope.userId,
  })

  return {
    variantId,
    variantSku,
    emptiedLocationId: ids.emptiedLocationId,
    emptiedLocationCode,
    stockedLocationId: ids.stockedLocationId,
    stockedLocationCode,
  }
}

async function cleanupFixtures(request: APIRequestContext, token: string, ids: FixtureIds) {
  await deleteGeneralEntityIfExists(request, token, '/api/wms/inventory-profiles', ids.profileId)
  await deleteGeneralEntityIfExists(request, token, '/api/wms/locations', ids.stockedLocationId)
  await deleteGeneralEntityIfExists(request, token, '/api/wms/locations', ids.emptiedLocationId)
  await deleteGeneralEntityIfExists(request, token, '/api/wms/warehouses', ids.warehouseId)
  await deleteCatalogProductIfExists(request, token, ids.productId)
}

function emptyFixtureIds(): FixtureIds {
  return { productId: null, warehouseId: null, emptiedLocationId: null, stockedLocationId: null, profileId: null }
}

test.describe('TC-WMS-037: Empty inventory balances are hidden from stock lists', () => {
  test('hideEmpty drops all-zero balances from the list API and the default keeps them', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const ids = emptyFixtureIds()
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES],
    )

    try {
      const fixture = await createEmptiedBucket(request, adminToken, ids, 'API')

      await expect
        .poll(() => listVariantBalanceLocations(request, adminToken, fixture.variantId), { timeout: 15_000 })
        .toEqual([fixture.emptiedLocationId, fixture.stockedLocationId].sort())

      expect(
        await listVariantBalanceLocations(request, adminToken, fixture.variantId, { hideEmpty: 'true' }),
      ).toEqual([fixture.stockedLocationId])
      expect(
        await listVariantBalanceLocations(request, adminToken, fixture.variantId, {
          hideEmpty: 'true',
          search: fixture.variantSku,
        }),
      ).toEqual([fixture.stockedLocationId])
      expect(
        await listVariantBalanceLocations(request, adminToken, fixture.variantId, { hideEmpty: 'false' }),
      ).toEqual([fixture.emptiedLocationId, fixture.stockedLocationId].sort())
    } finally {
      await cleanupFixtures(request, adminToken, ids)
      await restoreAdminAcl()
    }
  })

  test('inventory console and SKU view hide the emptied bucket until Show empty is chosen', async ({
    page,
    request,
  }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const ids = emptyFixtureIds()
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES],
    )

    try {
      const fixture = await createEmptiedBucket(request, adminToken, ids, 'UI')
      await expect
        .poll(
          () => listVariantBalanceLocations(request, adminToken, fixture.variantId, { search: fixture.variantSku }),
          { timeout: 15_000 },
        )
        .toHaveLength(2)

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/inventory')

      const balances = inventoryConsoleSection(page, 'balances')
      await balances.getByRole('searchbox', { name: 'Search balances' }).fill(fixture.variantSku)
      const stockedRow = balances.getByRole('row').filter({ hasText: fixture.stockedLocationCode })
      const emptiedRow = balances.getByRole('row').filter({ hasText: fixture.emptiedLocationCode })
      await expect(stockedRow).toHaveCount(1, { timeout: 15_000 })
      await expect(emptiedRow).toHaveCount(0)

      await balances.getByRole('button', { name: 'Show empty' }).click()
      await expect(emptiedRow).toHaveCount(1, { timeout: 15_000 })
      await expect(stockedRow).toHaveCount(1)

      await balances.getByRole('button', { name: 'Hide empty' }).click()
      await expect(emptiedRow).toHaveCount(0, { timeout: 15_000 })

      await page.goto(`/backend/wms/sku/${fixture.variantId}`)
      const distribution = page.locator('#stock-distribution')
      await expect(
        distribution.getByRole('row').filter({ hasText: fixture.stockedLocationCode }),
      ).toHaveCount(1, { timeout: 15_000 })
      await expect(distribution.getByRole('row').filter({ hasText: fixture.emptiedLocationCode })).toHaveCount(0)

      await distribution.getByRole('button', { name: 'Show empty' }).click()
      await expect(
        distribution.getByRole('row').filter({ hasText: fixture.emptiedLocationCode }),
      ).toHaveCount(1, { timeout: 15_000 })
    } finally {
      await cleanupFixtures(request, adminToken, ids)
      await restoreAdminAcl()
    }
  })
})
