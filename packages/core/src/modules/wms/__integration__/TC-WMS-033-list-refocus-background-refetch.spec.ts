import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
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
import {
  ensureEnglishLocale,
  selectLocationComboboxOption,
  submitInventoryDialog,
  waitForWmsMutationAccess,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

const RECEIVING_FEATURES = [
  'wms.view',
  'wms.manage_warehouses',
  'wms.manage_locations',
  'wms.manage_inventory',
  'wms.manage_asn',
  'wms.manage_putaway',
  'wms.receive_inventory',
  'wms.adjust_inventory',
] as const

const LOADING_TEXT = /Loading data/i

/**
 * Holds the next matching background GET once `arm()` is called, so a test
 * can dispatch a refocus/search trigger, observe the request in flight, make
 * assertions while it is pending, then release it deterministically. Avoids
 * racing a fixed timeout against the real refetch.
 */
async function createRefetchGate(page: Page, pathname: string) {
  let armed = false
  let onHit: (() => void) | null = null
  let releaseResolve: (() => void) | null = null
  let releasePromise: Promise<void> = Promise.resolve()

  await page.route(`**${pathname}*`, async (route) => {
    const request = route.request()
    let matchesPath = false
    try {
      matchesPath = new URL(request.url()).pathname === pathname
    } catch {
      matchesPath = false
    }
    if (!armed || request.method() !== 'GET' || !matchesPath) {
      await route.continue()
      return
    }
    armed = false
    const resolveHit = onHit
    onHit = null
    resolveHit?.()
    await releasePromise
    await route.continue()
  })

  return {
    arm(): Promise<void> {
      armed = true
      releasePromise = new Promise((resolve) => {
        releaseResolve = resolve
      })
      return new Promise<void>((resolve) => {
        onHit = resolve
      })
    },
    release() {
      releaseResolve?.()
    },
  }
}

test.describe('TC-WMS-033: WMS list pages avoid loading flash on background refetches', () => {
  test('ASNs list keeps rows visible on a refocus refetch and shows initial-loading feedback on a search query-key change', async ({
    page,
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const asnRef = `TC033-ASN-${suffix}`

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...RECEIVING_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let asnId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC033 ASN Refocus ${suffix}`,
        sku: `TC033-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC033 ASN Refocus Variant ${suffix}`,
        sku: `TC033-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC033 Warehouse ${suffix}`,
        code: `TC033W${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      stagingId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `STG-${suffix}`,
        type: 'staging',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      const asnCreate = await postAction<{ id?: string }>(request, adminToken, '/api/wms/asns', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        expectedAt: new Date().toISOString(),
        referenceNumber: asnRef,
        status: 'in_transit',
        lines: [
          {
            catalogVariantId: variantId,
            expectedQty: 5,
            targetStagingLocationId: stagingId,
          },
        ],
      })
      asnId = asnCreate.id ?? null
      expect(asnId).toBeTruthy()

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/asns')
      await waitForWmsMutationAccess(page)

      const asnRow = page.getByRole('link', { name: asnRef })
      await expect(asnRow).toBeVisible({ timeout: 15_000 })

      const gate = await createRefetchGate(page, '/api/wms/asns')

      // Refocus-triggered background refetch: existing row stays visible, no loading flash.
      const refocusHit = gate.arm()
      // React Query's focusManager listens on `window`, not `document` — the native
      // visibilitychange event doesn't bubble, so it must be dispatched on `window`
      // directly for the background-refetch listener to fire.
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
      await refocusHit
      await expect(page.getByText(LOADING_TEXT)).toHaveCount(0)
      await expect(asnRow).toBeVisible()
      gate.release()
      await page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === '/api/wms/asns' &&
          response.ok(),
      )
      await expect(asnRow).toBeVisible()

      // Changing the search query key creates a brand-new React Query cache entry
      // (search is part of the queryKey), so the page unmounts the DataTable section
      // and shows its own page-level loading message instead of DataTable's internal
      // "Loading data..." row — assert on that initial-loading feedback instead.
      const searchHit = gate.arm()
      const searchInput = page.getByPlaceholder(/search asns/i)
      await fillControlledInput(searchInput, asnRef)
      await searchHit
      await expect(page.getByText(/Loading ASNs/i)).toBeVisible()
      gate.release()
      await expect(asnRow).toBeVisible({ timeout: 10_000 })
    } finally {
      if (asnId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      }
      if (stagingId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      }
      if (warehouseId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      }
      if (productId) {
        await deleteCatalogProductIfExists(request, adminToken, productId)
      }
      await restoreAdminAcl()
    }
  })

  test('Lots list keeps rows visible during a refocus-triggered background refetch', async ({ page, request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const lotNumber = `TC033-LOT-${suffix}`

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_warehouses', 'wms.manage_locations', 'wms.manage_inventory', 'wms.adjust_inventory'],
    )

    let productId: string | null = null
    let variantId: string | null = null
    let lotId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC033 Lot Refocus ${suffix}`,
        sku: `TC033-LP-${suffix}`,
      })
      variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC033 Lot Refocus Variant ${suffix}`,
        sku: `TC033-LV-${suffix}`,
      })

      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TC033-LV-${suffix}`,
        lotNumber,
        status: 'available',
      })

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/lots')
      await waitForWmsMutationAccess(page)

      const lotRow = page.getByRole('link', { name: lotNumber })
      await expect(lotRow).toBeVisible({ timeout: 15_000 })

      const gate = await createRefetchGate(page, '/api/wms/lots')
      const refocusHit = gate.arm()
      // React Query's focusManager listens on `window`, not `document` — the native
      // visibilitychange event doesn't bubble, so it must be dispatched on `window`
      // directly for the background-refetch listener to fire.
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
      await refocusHit
      await expect(page.getByText(LOADING_TEXT)).toHaveCount(0)
      await expect(lotRow).toBeVisible()
      gate.release()
      await page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === '/api/wms/lots' &&
          response.ok(),
      )
      await expect(lotRow).toBeVisible()
    } finally {
      if (lotId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
      }
      if (productId) {
        await deleteCatalogProductIfExists(request, adminToken, productId)
      }
      await restoreAdminAcl()
    }
  })

  test('Putaway queue keeps the completed row visible through its post-completion refetch, then drops it from the active queue', async ({
    page,
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)
    const stagingCode = `STG-${suffix}`
    const binCode = `BIN-${suffix}`

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [...RECEIVING_FEATURES],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let binId: string | null = null
    let profileId: string | null = null
    let asnId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC033 Putaway Refocus ${suffix}`,
        sku: `TC033-PP-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC033 Putaway Refocus Variant ${suffix}`,
        sku: `TC033-PV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC033 Putaway Warehouse ${suffix}`,
        code: `TC033PW${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      stagingId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: stagingCode,
        type: 'staging',
        capacityUnits: 100,
        capacityWeight: 500,
        isActive: true,
      })

      binId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: binCode,
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

      const asnCreate = await postAction<{ id?: string; lineIds?: string[] }>(
        request,
        adminToken,
        '/api/wms/asns',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          expectedAt: new Date().toISOString(),
          referenceNumber: `TC033-ASN-${suffix}`,
          status: 'in_transit',
          lines: [
            {
              catalogVariantId: variantId,
              expectedQty: 5,
              targetStagingLocationId: stagingId,
            },
          ],
        },
      )
      asnId = asnCreate.id ?? null
      const lineId = asnCreate.lineIds?.[0] ?? null
      expect(asnId).toBeTruthy()
      expect(lineId).toBeTruthy()

      // Receive the line via the API directly (QC-passed) — the UI receive flow
      // is already covered elsewhere; this fixture only needs the resulting
      // open putaway task.
      await postAction(request, adminToken, `/api/wms/asns/${asnId}/receive`, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineId,
        receivedQty: 5,
        targetReceivedQty: 5,
        targetStagingLocationId: stagingId,
        qcStatus: 'passed',
        performedBy: scope.userId,
      })

      await login(page, 'admin')
      await ensureEnglishLocale(page)
      await page.goto('/backend/wms/putaway')
      await waitForWmsMutationAccess(page)

      const putawayRow = page.getByRole('row').filter({ hasText: stagingCode }).first()
      await expect(putawayRow).toBeVisible({ timeout: 15_000 })

      const gate = await createRefetchGate(page, '/api/wms/putaway-tasks')

      await putawayRow.getByRole('button', { name: /Open actions|Otwórz akcje/i }).click()
      await page.getByRole('menuitem', { name: /Complete/i }).click()

      const putawayDialog = page.getByRole('dialog').filter({ hasText: /Complete putaway/i }).first()
      await expect(putawayDialog).toBeVisible()
      await selectLocationComboboxOption(page, putawayDialog, 'Select destination bin', binCode)

      // The dialog's own submit handler `await`s `invalidateQueries(['wms-putaway-queue'])`
      // before closing — that invalidation is the GET this test observes, so the gate
      // must be armed before clicking submit but the dialog-close assertion must wait
      // until after the gate is released, not before.
      const completionRefetchHit = gate.arm()
      const completeResponsePromise = submitInventoryDialog(page, putawayDialog, {
        submitTestId: 'complete-putaway-submit',
        apiPath: '/api/wms/putaway-tasks/',
      })

      await completionRefetchHit
      await expect(page.getByText(LOADING_TEXT)).toHaveCount(0)
      // The modal dialog is still open here (it closes only once the held GET
      // resolves), and Radix marks the rest of the page aria-hidden while open —
      // `getByRole('row')` can't see it, so assert on the row's text content
      // instead of its accessible role.
      await expect(page.getByText(stagingCode, { exact: false }).first()).toBeVisible()
      gate.release()

      const completeResponse = await completeResponsePromise
      expect(completeResponse.url()).toContain('/complete')
      expect(completeResponse.ok()).toBeTruthy()
      await expect(putawayDialog).toBeHidden({ timeout: 10_000 })
      await expect(putawayRow).toHaveCount(0)
    } finally {
      if (asnId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      }
      if (profileId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      }
      if (binId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', binId)
      }
      if (stagingId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      }
      if (warehouseId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      }
      if (productId) {
        await deleteCatalogProductIfExists(request, adminToken, productId)
      }
      await restoreAdminAcl()
    }
  })
})
