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
import { waitForApiMutation } from '@open-mercato/core/helpers/integration/ui'
import { createCrudFixture, ensureRoleFeatures, postAction } from './helpers/wmsFixtures'
import { ensureEnglishLocale } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

const STOCK_FEATURES = [
  'wms.view',
  'wms.manage_warehouses',
  'wms.manage_locations',
  'wms.receive_inventory',
  'wms.adjust_inventory',
]

const HAS_STOCK_MESSAGE = 'This warehouse still holds inventory. Move or adjust its stock to zero before archiving it.'

type Fixture = {
  token: string
  scope: ReturnType<typeof getTokenScope>
  suffix: string
  productId: string | null
  variantId: string | null
  warehouseId: string | null
  locationId: string | null
}

async function createStockedWarehouse(request: APIRequestContext, fixture: Fixture, quantity: number, markStocked: () => void) {
  const { token, scope, suffix } = fixture
  fixture.productId = await createProductFixture(request, token, {
    title: `TC-WMS-WAREHOUSE-DELETE ${suffix}`,
    sku: `TCWD-P-${suffix}`,
  })
  fixture.variantId = await createVariantFixture(request, token, {
    productId: fixture.productId,
    name: `TC-WMS-WAREHOUSE-DELETE Variant ${suffix}`,
    sku: `TCWD-${suffix}`,
  })
  fixture.warehouseId = await createCrudFixture(request, token, '/api/wms/warehouses', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    name: `TC-WMS-WAREHOUSE-DELETE ${suffix}`,
    code: `TCWD${suffix}`,
    isActive: true,
    timezone: 'UTC',
  })
  fixture.locationId = await createCrudFixture(request, token, '/api/wms/locations', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId: fixture.warehouseId,
    code: `TCWD-BIN-${suffix}`,
    type: 'bin',
    isActive: true,
  })
  markStocked()
  await postAction(request, token, '/api/wms/inventory/receive', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId: fixture.warehouseId,
    locationId: fixture.locationId,
    catalogVariantId: fixture.variantId,
    quantity,
    referenceType: 'manual',
    referenceId: randomUUID(),
    performedBy: scope.userId,
  })
}

async function adjustStock(request: APIRequestContext, fixture: Fixture, delta: number) {
  await postAction(request, fixture.token, '/api/wms/inventory/adjust', {
    organizationId: fixture.scope.organizationId,
    tenantId: fixture.scope.tenantId,
    warehouseId: fixture.warehouseId,
    locationId: fixture.locationId,
    catalogVariantId: fixture.variantId,
    delta,
    reason: 'TC-WMS-WAREHOUSE-DELETE cleanup',
    referenceType: 'manual',
    referenceId: randomUUID(),
    performedBy: fixture.scope.userId,
  })
}

async function cleanupFixture(request: APIRequestContext, fixture: Fixture, remainingStock: () => number) {
  if (fixture.warehouseId && fixture.locationId && fixture.variantId && remainingStock() > 0) {
    await adjustStock(request, fixture, -remainingStock()).catch(() => undefined)
  }
  await deleteGeneralEntityIfExists(request, fixture.token, '/api/wms/locations', fixture.locationId)
  await deleteGeneralEntityIfExists(request, fixture.token, '/api/wms/warehouses', fixture.warehouseId)
  await deleteCatalogProductIfExists(request, fixture.token, fixture.productId)
}

async function isWarehouseListed(request: APIRequestContext, token: string, warehouseId: string): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `/api/wms/warehouses?ids=${encodeURIComponent(warehouseId)}`, { token })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
  return (body?.items ?? []).some((item) => item.id === warehouseId)
}

test.describe('TC-WMS-WAREHOUSE-DELETE-001: a warehouse that still holds stock cannot be archived', () => {
  test('DELETE answers 409 while stock remains and succeeds once the stock is adjusted to zero', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const fixture: Fixture = {
      token: adminToken,
      scope,
      suffix: randomUUID().slice(0, 8),
      productId: null,
      variantId: null,
      warehouseId: null,
      locationId: null,
    }
    let stock = 0
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', STOCK_FEATURES)

    try {
      await createStockedWarehouse(request, fixture, 5, () => {
        stock = 5
      })
      const warehouseId = fixture.warehouseId as string

      const refused = await apiRequest(request, 'DELETE', `/api/wms/warehouses?id=${encodeURIComponent(warehouseId)}`, {
        token: adminToken,
      })
      expect(refused.status()).toBe(409)
      const refusedBody = await readJsonSafe<{ error?: string }>(refused)
      expect(refusedBody?.error).toBe(HAS_STOCK_MESSAGE)
      expect(await isWarehouseListed(request, adminToken, warehouseId)).toBe(true)

      await adjustStock(request, fixture, -5)
      stock = 0

      const archived = await apiRequest(request, 'DELETE', `/api/wms/warehouses?id=${encodeURIComponent(warehouseId)}`, {
        token: adminToken,
      })
      expect(archived.ok(), `Failed DELETE warehouse: ${archived.status()}`).toBeTruthy()
      expect(await isWarehouseListed(request, adminToken, warehouseId)).toBe(false)
    } finally {
      await cleanupFixture(request, fixture, () => stock)
      await restoreAdminAcl()
    }
  })

  test('archiving a stocked warehouse from the configuration page shows the refusal and keeps the row', async ({
    page,
    request,
  }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const fixture: Fixture = {
      token: adminToken,
      scope,
      suffix: randomUUID().slice(0, 8),
      productId: null,
      variantId: null,
      warehouseId: null,
      locationId: null,
    }
    let stock = 0
    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', STOCK_FEATURES)

    try {
      await createStockedWarehouse(request, fixture, 3, () => {
        stock = 3
      })

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/config/wms')
      await page.getByRole('searchbox', { name: 'Search warehouses' }).fill(`TCWD${fixture.suffix}`)
      const row = page.getByRole('row').filter({ hasText: `TCWD${fixture.suffix}` })
      await expect(row).toHaveCount(1, { timeout: 15_000 })

      const actionsButton = row.getByRole('button', { name: 'Open actions' })
      await actionsButton.focus()
      await actionsButton.press('Enter')
      await page.getByRole('menuitem', { name: /^Delete$/i }).click()
      const confirmDialog = page.getByRole('alertdialog').first()
      await expect(confirmDialog).toContainText(/Archive warehouse/i)

      const deleteResponse = await waitForApiMutation(
        page,
        '/api/wms/warehouses',
        async () => {
          await confirmDialog.getByRole('button', { name: /^Confirm$/i }).click()
        },
        'DELETE',
        20_000,
      )
      expect(deleteResponse.status()).toBe(409)
      await expect(page.getByText(HAS_STOCK_MESSAGE)).toBeVisible({ timeout: 10_000 })
      await expect(row).toHaveCount(1)
    } finally {
      await cleanupFixture(request, fixture, () => stock)
      await restoreAdminAcl()
    }
  })
})
