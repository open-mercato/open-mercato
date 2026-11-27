import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
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
import {
  ensureEnglishLocale,
  inventoryConsoleSection,
  WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type SerialBalanceListResponse = {
  items?: Array<{ serial_number?: string | null }>
}

type FixtureIds = {
  productId: string | null
  warehouseId: string | null
  locationId: string | null
  profileId: string | null
}

async function listSerialsAtVariant(
  request: APIRequestContext,
  token: string,
  variantId: string,
): Promise<string[]> {
  const params = new URLSearchParams({ catalogVariantId: variantId, page: '1', pageSize: '100' })
  const response = await apiRequest(request, 'GET', `/api/wms/inventory/balances?${params.toString()}`, { token })
  expect(response.ok(), `Failed GET balances: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<SerialBalanceListResponse>(response)
  return (body?.items ?? []).map((item) => String(item.serial_number ?? '')).sort((left, right) => left.localeCompare(right))
}

function movementLedgerSection(page: Page) {
  return page.locator('section').filter({
    has: page.getByRole('heading', { level: 2, name: 'Inventory movement ledger' }),
  })
}

test.describe('TC-WMS-039: Inventory console shows serial numbers', () => {
  test('balances and movement ledger list the serial number of each unit', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const locationCode = `SN-BIN-${suffix}`
    const serials = [`SN-A-${suffix}`, `SN-B-${suffix}`]
    const ids: FixtureIds = { productId: null, warehouseId: null, locationId: null, profileId: null }
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...WMS_INVENTORY_CONSOLE_ROW_ACTION_FEATURES, 'wms.receive_inventory'],
    )

    try {
      ids.productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-039 ${suffix}`,
        sku: `TCW39-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId: ids.productId,
        name: `TC-WMS-039 Variant ${suffix}`,
        sku: `TCW39-${suffix}`,
      })
      ids.warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-039 WH ${suffix}`,
        code: `TCW39${suffix}`,
        isActive: true,
        timezone: 'UTC',
      })
      ids.locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId: ids.warehouseId,
        code: locationCode,
        type: 'bin',
        isActive: true,
      })
      ids.profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: ids.productId,
        catalogVariantId: variantId,
        defaultUom: 'pc',
        defaultStrategy: 'fifo',
        trackSerial: true,
      })

      for (const serialNumber of serials) {
        await postAction(request, adminToken, '/api/wms/inventory/receive', {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId: ids.warehouseId,
          locationId: ids.locationId,
          catalogVariantId: variantId,
          serialNumber,
          quantity: 1,
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        })
      }
      await expect
        .poll(() => listSerialsAtVariant(request, adminToken, variantId), { timeout: 15_000 })
        .toEqual([...serials].sort((left, right) => left.localeCompare(right)))

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/inventory')

      const balances = inventoryConsoleSection(page, 'balances')
      const ledger = movementLedgerSection(page)
      await expect(balances.getByRole('columnheader', { name: 'Serial number' })).toBeVisible({ timeout: 15_000 })
      await expect(ledger.getByRole('columnheader', { name: 'Serial number' })).toBeVisible()

      for (const serialNumber of serials) {
        await balances.getByRole('searchbox', { name: 'Search balances' }).fill(serialNumber)
        const balanceRow = balances.getByRole('row').filter({ hasText: locationCode })
        await expect(balanceRow).toHaveCount(1, { timeout: 15_000 })
        await expect(balanceRow.getByRole('cell', { name: serialNumber, exact: true })).toBeVisible()

        await ledger.getByRole('searchbox', { name: 'Search movement ledger' }).fill(serialNumber)
        const movementRow = ledger.getByRole('row').filter({ hasText: locationCode })
        await expect(movementRow).toHaveCount(1, { timeout: 15_000 })
        await expect(movementRow.getByRole('cell', { name: serialNumber, exact: true })).toBeVisible()
      }

      await page.goto('/backend/wms/movements')
      const movementsPage = movementLedgerSection(page)
      await movementsPage.getByRole('searchbox', { name: 'Search movement ledger' }).fill(serials[0])
      const movementsPageRow = movementsPage.getByRole('row').filter({ hasText: locationCode })
      await expect(movementsPageRow).toHaveCount(1, { timeout: 15_000 })
      await expect(movementsPageRow.getByRole('cell', { name: serials[0], exact: true })).toBeVisible()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', ids.profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', ids.locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', ids.warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, ids.productId)
      await restoreAdminAcl()
    }
  })
})
