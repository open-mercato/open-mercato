import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { waitForApiMutation } from '@open-mercato/core/helpers/integration/ui'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'
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

const HAS_STOCK_MESSAGE = 'This warehouse still holds inventory. Adjust its stock to zero and release its reservations and allocations before archiving it.'
const HAS_STOCK_MESSAGE_PL = 'Ten magazyn nadal zawiera zapasy. Skoryguj jego stan do zera i zwolnij rezerwacje oraz alokacje przed archiwizacją.'

type Fixture = {
  token: string
  scope: ReturnType<typeof getTokenScope>
  suffix: string
  productId: string | null
  variantId: string | null
  warehouseId: string | null
  locationId: string | null
  stock: number
  restoreAcl: () => Promise<void>
}

async function startFixture(request: APIRequestContext): Promise<Fixture> {
  const token = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(token)
  const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', STOCK_FEATURES)
  return {
    token,
    scope,
    suffix: randomUUID().slice(0, 8),
    productId: null,
    variantId: null,
    warehouseId: null,
    locationId: null,
    stock: 0,
    restoreAcl,
  }
}

async function createStockedWarehouse(request: APIRequestContext, fixture: Fixture, quantity: number): Promise<APIResponse> {
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
  const warehouseCreated = await apiRequest(request, 'POST', '/api/wms/warehouses', {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: `TC-WMS-WAREHOUSE-DELETE ${suffix}`,
      code: `TCWD${suffix}`,
      isActive: true,
      timezone: 'UTC',
    },
  })
  expect(warehouseCreated.ok(), `Failed POST /api/wms/warehouses: ${warehouseCreated.status()}`).toBeTruthy()
  const warehouseBody = await readJsonSafe<{ id?: string }>(warehouseCreated)
  fixture.warehouseId = expectId(warehouseBody?.id, 'Missing id in /api/wms/warehouses create response')
  fixture.locationId = await createCrudFixture(request, token, '/api/wms/locations', {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouseId: fixture.warehouseId,
    code: `TCWD-BIN-${suffix}`,
    type: 'bin',
    isActive: true,
  })
  fixture.stock = quantity
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
  return warehouseCreated
}

async function adjustStockToZero(request: APIRequestContext, fixture: Fixture) {
  await postAction(request, fixture.token, '/api/wms/inventory/adjust', {
    organizationId: fixture.scope.organizationId,
    tenantId: fixture.scope.tenantId,
    warehouseId: fixture.warehouseId,
    locationId: fixture.locationId,
    catalogVariantId: fixture.variantId,
    delta: -fixture.stock,
    reason: 'TC-WMS-WAREHOUSE-DELETE cleanup',
    referenceType: 'manual',
    referenceId: randomUUID(),
    performedBy: fixture.scope.userId,
  })
  fixture.stock = 0
}

async function cleanupFixture(request: APIRequestContext, fixture: Fixture) {
  if (fixture.warehouseId && fixture.locationId && fixture.variantId && fixture.stock > 0) {
    await adjustStockToZero(request, fixture).catch(() => undefined)
  }
  await deleteGeneralEntityIfExists(request, fixture.token, '/api/wms/locations', fixture.locationId)
  await deleteGeneralEntityIfExists(request, fixture.token, '/api/wms/warehouses', fixture.warehouseId)
  await deleteCatalogProductIfExists(request, fixture.token, fixture.productId)
  await fixture.restoreAcl()
}

async function deleteWarehouse(request: APIRequestContext, fixture: Fixture, locale?: string): Promise<APIResponse> {
  return apiRequest(request, 'DELETE', `/api/wms/warehouses?id=${encodeURIComponent(fixture.warehouseId ?? '')}`, {
    token: fixture.token,
    ...(locale ? { headers: { 'Accept-Language': locale } } : {}),
  })
}

async function expectHasStockRefusal(response: APIResponse, message?: string) {
  expect(response.status()).toBe(409)
  const body = await readJsonSafe<{ error?: string; code?: string }>(response)
  expect(body?.code).toBe('warehouse_has_stock')
  if (message) expect(body?.error).toBe(message)
}

async function isWarehouseListed(request: APIRequestContext, fixture: Fixture): Promise<boolean> {
  const warehouseId = fixture.warehouseId ?? ''
  const response = await apiRequest(request, 'GET', `/api/wms/warehouses?ids=${encodeURIComponent(warehouseId)}`, {
    token: fixture.token,
  })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
  return (body?.items ?? []).some((item) => item.id === warehouseId)
}

test.describe('TC-WMS-WAREHOUSE-DELETE-001: a warehouse that still holds stock cannot be archived', () => {
  test('DELETE answers 409 while stock remains and succeeds once the stock is adjusted to zero', async ({ request }) => {
    const fixture = await startFixture(request)
    try {
      await createStockedWarehouse(request, fixture, 5)

      await expectHasStockRefusal(await deleteWarehouse(request, fixture), HAS_STOCK_MESSAGE)
      await expectHasStockRefusal(await deleteWarehouse(request, fixture, 'pl'), HAS_STOCK_MESSAGE_PL)
      expect(await isWarehouseListed(request, fixture)).toBe(true)

      await adjustStockToZero(request, fixture)

      const archived = await deleteWarehouse(request, fixture)
      expect(archived.ok(), `Failed DELETE warehouse: ${archived.status()}`).toBeTruthy()
      expect(await isWarehouseListed(request, fixture)).toBe(false)
    } finally {
      await cleanupFixture(request, fixture)
    }
  })

  test('undoing the warehouse create answers 409 while stock remains and succeeds once the stock is adjusted to zero', async ({
    request,
  }) => {
    skipIfUndoTestsDisabled()
    const fixture = await startFixture(request)
    try {
      const operation = expectOperation(await createStockedWarehouse(request, fixture, 4), 'warehouse create')

      await expectHasStockRefusal(await undoByToken(request, fixture.token, operation.undoToken))
      expect(await isWarehouseListed(request, fixture)).toBe(true)

      await adjustStockToZero(request, fixture)

      const undone = await undoByToken(request, fixture.token, operation.undoToken)
      expect(undone.ok(), `Failed undo of warehouse create: ${undone.status()}`).toBeTruthy()
      expect(await isWarehouseListed(request, fixture)).toBe(false)
    } finally {
      await cleanupFixture(request, fixture)
    }
  })

  test('archiving a stocked warehouse from the configuration page shows the refusal and keeps the row', async ({
    page,
    request,
  }) => {
    test.slow()
    const fixture = await startFixture(request)
    try {
      await createStockedWarehouse(request, fixture, 3)

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
      expect(await isWarehouseListed(request, fixture)).toBe(true)
    } finally {
      await cleanupFixture(request, fixture)
    }
  })
})
