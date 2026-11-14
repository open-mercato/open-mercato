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
  postAction,
} from './helpers/wmsFixtures'
import {
  fillCombobox,
  selectLocationComboboxOption,
  setWmsLocale,
  submitInventoryDialog,
  waitForDialogSubmitReady,
  waitForWmsMutationAccess,
} from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

/**
 * WMS-P2-INT-08 / Source: .ai/specs/2026-04-15-wms-phase-2-inbound-putaway.md
 * Receive ASN line and complete putaway from backend queues.
 */
test.describe('TC-WMS-P2-INT-08: ASN receive + putaway UI', () => {
  test('receives an ASN line and completes putaway from backend pages', async ({ page, request }) => {
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
      [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.manage_asn',
        'wms.manage_putaway',
        'wms.receive_inventory',
        'wms.adjust_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let binId: string | null = null
    let profileId: string | null = null
    let asnId: string | null = null
    let lineId: string | null = null
    const warehouseName = `P2-UI WH ${suffix}`
    const stagingCode = `STG-${suffix}`
    const binCode = `BIN-${suffix}`
    const variantSku = `P2UI-V-${suffix}`
    const asnRef = `ASN-UI-${suffix}`

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `P2 UI ASN ${suffix}`,
        sku: `P2UI-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `P2 UI Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: `P2U${suffix}`,
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
          referenceNumber: asnRef,
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
      lineId = asnCreate.lineIds?.[0] ?? null
      expect(asnId).toBeTruthy()
      expect(lineId).toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/wms/asns/${asnId}`)
      await waitForWmsMutationAccess(page)

      await expect(page.getByRole('heading', { name: asnRef })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('heading', { name: /Receiving lines/i })).toBeVisible()

      await page.getByRole('button', { name: /Open actions|Otwórz akcje/i }).first().click()
      await page.getByRole('menuitem', { name: /Receive line/i }).click()

      const receiveDialog = page.getByRole('dialog').filter({ hasText: /Receive ASN line/i }).first()
      await expect(receiveDialog).toBeVisible()

      // ASN create already seeds targetStagingLocationId; assert the resolved label
      // rather than re-typing into ComboboxInput (allowCustomValues=false).
      await expect(receiveDialog.getByPlaceholder('Select staging or dock')).toHaveValue(
        stagingCode,
        { timeout: 10_000 },
      )

      const receiveResponse = await submitInventoryDialog(page, receiveDialog, {
        submitTestId: 'receive-asn-submit',
        apiPath: `/api/wms/asns/${asnId}/receive`,
      })
      expect(receiveResponse.ok()).toBeTruthy()

      await expect(receiveDialog).toBeHidden({ timeout: 10_000 })
      await expect(page.getByText(/Passed|QC/i).first()).toBeVisible()

      await page.goto('/backend/wms/putaway')
      await waitForWmsMutationAccess(page)
      await expect(page.getByRole('heading', { level: 1, name: /Putaway queue/i })).toBeVisible({
        timeout: 15_000,
      })

      const putawayRow = page.getByRole('row').filter({ hasText: stagingCode }).first()
      await expect(putawayRow).toBeVisible({ timeout: 15_000 })
      await putawayRow.getByRole('button', { name: /Open actions|Otwórz akcje/i }).click()
      await page.getByRole('menuitem', { name: /Complete/i }).click()

      const putawayDialog = page.getByRole('dialog').filter({ hasText: /Complete putaway/i }).first()
      await expect(putawayDialog).toBeVisible()
      await expect(putawayDialog.getByTestId('complete-putaway-qty')).toHaveValue('5')

      await selectLocationComboboxOption(
        page,
        putawayDialog,
        'Select destination bin',
        binCode,
      )

      const completeResponse = await submitInventoryDialog(page, putawayDialog, {
        submitTestId: 'complete-putaway-submit',
        apiPath: '/api/wms/putaway-tasks/',
      })
      expect(completeResponse.url()).toContain('/complete')
      expect(completeResponse.ok()).toBeTruthy()
      await expect(putawayDialog).toBeHidden({ timeout: 10_000 })
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

  test('blocks invalid submits with translated messages in Create ASN, Receive line, and Complete putaway (Polish)', async ({
    page,
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.manage_asn',
        'wms.manage_putaway',
        'wms.receive_inventory',
        'wms.adjust_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let binId: string | null = null
    let profileId: string | null = null
    let asnId: string | null = null
    const warehouseName = `P2-I18N WH ${suffix}`
    const stagingCode = `I18N-STG-${suffix}`
    const binCode = `I18N-BIN-${suffix}`
    const variantSku = `P2I18N-V-${suffix}`
    const asnRef = `ASN-I18N-${suffix}`
    const postRequests: string[] = []

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `P2 I18N ASN ${suffix}`,
        sku: `P2I18N-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `P2 I18N Variant ${suffix}`,
        sku: variantSku,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: warehouseName,
        code: `P2I${suffix}`,
        city: 'Wroclaw',
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
          referenceNumber: asnRef,
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
      expect(asnId).toBeTruthy()

      await login(page, 'admin')
      await setWmsLocale(page, 'pl')
      page.on('request', (req) => {
        if (req.method() === 'POST') postRequests.push(req.url())
      })

      // Create ASN: an empty submit surfaces translated warehouse/variant errors and writes nothing.
      // The very first submit on a freshly opened dialog races the ASN mutation-access resolution
      // (useWmsInventoryMutationAccess's scopeReady only flips true once the feature-check round
      // trip commits); `toPass` re-clicks submit — a harmless, idempotent action — until either the
      // error renders or the timeout elapses, instead of asserting against a single racy attempt.
      await page.goto('/backend/wms/asns')
      await waitForWmsMutationAccess(page)
      await page.getByRole('button', { name: 'Utwórz ASN' }).first().click()
      let createDialog = page.getByRole('dialog').filter({ hasText: 'Utwórz ASN' }).first()
      await expect(createDialog).toBeVisible()

      await expect(async () => {
        await createDialog.getByTestId('create-asn-submit').click()
        await expect(createDialog.getByText('Wybierz magazyn.')).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await expect(createDialog.getByText('Wybierz wariant.')).toBeVisible()
      await expect(createDialog.getByText('Invalid UUID')).toHaveCount(0)
      await expect(createDialog.getByText(/Too small/)).toHaveCount(0)
      expect(postRequests.some((url) => url.includes('/api/wms/asns'))).toBe(false)

      // Close and reopen: `fieldErrors` only resets when the dialog's `open` prop flips, not by
      // editing a field, so reusing this instance for the next check would see the warehouse/variant
      // errors above as still-present "stale" alerts instead of a clean slate.
      await createDialog.getByRole('button', { name: 'Anuluj' }).click()
      await expect(createDialog).toBeHidden({ timeout: 10_000 })

      // A nonpositive expected quantity, submitted with Ctrl+Enter, surfaces a translated error too.
      await page.getByRole('button', { name: 'Utwórz ASN' }).first().click()
      createDialog = page.getByRole('dialog').filter({ hasText: 'Utwórz ASN' }).first()
      await expect(createDialog).toBeVisible()

      await fillCombobox(page, 'Wybierz magazyn', warehouseName, {
        scope: createDialog,
        suggestionsApiPath: '/api/wms/warehouses',
      })
      await fillCombobox(page, 'Szukaj wariantu lub SKU', variantSku, {
        scope: createDialog,
        suggestionsApiPath: '/api/catalog/variants',
      })
      const expectedQtyInput = createDialog.locator('input[type="number"]').first()
      await expectedQtyInput.fill('0')
      await expectedQtyInput.press('Control+Enter')
      await expect(createDialog.getByText('Oczekiwana ilość musi być większa od 0.')).toBeVisible()
      await expect(createDialog.getByText(/Too small/)).toHaveCount(0)
      expect(postRequests.some((url) => url.includes('/api/wms/asns'))).toBe(false)

      await createDialog.getByRole('button', { name: 'Anuluj' }).click()
      await expect(createDialog).toBeHidden({ timeout: 10_000 })

      // Receive line: a nonpositive received quantity, submitted with Ctrl+Enter, surfaces a translated error.
      await page.goto(`/backend/wms/asns/${asnId}`)
      await waitForWmsMutationAccess(page)
      await page.getByRole('button', { name: /Open actions|Otwórz akcje/i }).first().click()
      await page.getByRole('menuitem', { name: 'Przyjmij pozycję' }).click()

      let receiveDialog = page.getByRole('dialog').filter({ hasText: 'Przyjmij pozycję ASN' }).first()
      await expect(receiveDialog).toBeVisible()
      await waitForDialogSubmitReady(page, receiveDialog, 'receive-asn-submit')
      const invalidReceivedQtyInput = receiveDialog.getByTestId('receive-asn-qty')
      await invalidReceivedQtyInput.fill('0')
      await invalidReceivedQtyInput.press('Control+Enter')
      await expect(receiveDialog.getByText('Przyjęta ilość musi być większa od 0.')).toBeVisible()
      await expect(receiveDialog.getByText(/Too small/)).toHaveCount(0)
      expect(
        postRequests.some((url) => url.includes(`/api/wms/asns/${asnId}/receive`)),
      ).toBe(false)

      // Close and reopen for the same reason as Create ASN above — the stale "quantity positive"
      // alert would otherwise fail `submitInventoryDialog`'s own pre-submit no-field-errors check.
      await receiveDialog.getByRole('button', { name: 'Anuluj' }).click()
      await expect(receiveDialog).toBeHidden({ timeout: 10_000 })

      // Receive the line for real so a putaway task exists for the next assertion.
      await page.getByRole('button', { name: /Open actions|Otwórz akcje/i }).first().click()
      await page.getByRole('menuitem', { name: 'Przyjmij pozycję' }).click()
      receiveDialog = page.getByRole('dialog').filter({ hasText: 'Przyjmij pozycję ASN' }).first()
      await expect(receiveDialog).toBeVisible()
      await receiveDialog.getByTestId('receive-asn-qty').fill('5')
      const receiveResponse = await submitInventoryDialog(page, receiveDialog, {
        submitTestId: 'receive-asn-submit',
        apiPath: `/api/wms/asns/${asnId}/receive`,
      })
      expect(receiveResponse.ok()).toBeTruthy()
      await expect(receiveDialog).toBeHidden({ timeout: 10_000 })

      // Complete putaway: a nonpositive confirmed quantity, submitted with Ctrl+Enter, surfaces a translated error.
      await page.goto('/backend/wms/putaway')
      await waitForWmsMutationAccess(page)
      const putawayRow = page.getByRole('row').filter({ hasText: stagingCode }).first()
      await expect(putawayRow).toBeVisible({ timeout: 15_000 })
      await putawayRow.getByRole('button', { name: /Open actions|Otwórz akcje/i }).click()
      await page.getByRole('menuitem', { name: 'Zakończ' }).click()

      let putawayDialog = page.getByRole('dialog').filter({ hasText: 'Zakończ rozlokowanie' }).first()
      await expect(putawayDialog).toBeVisible()
      await waitForDialogSubmitReady(page, putawayDialog, 'complete-putaway-submit')
      const invalidConfirmedQtyInput = putawayDialog.getByTestId('complete-putaway-qty')
      await invalidConfirmedQtyInput.fill('0')
      await invalidConfirmedQtyInput.press('Control+Enter')
      await expect(putawayDialog.getByText('Potwierdzona ilość musi być większa od 0.')).toBeVisible()
      await expect(putawayDialog.getByText(/Too small/)).toHaveCount(0)
      expect(
        postRequests.some(
          (url) => url.includes('/api/wms/putaway-tasks/') && url.includes('/complete'),
        ),
      ).toBe(false)

      // Close and reopen for the same reason as above, then complete the task for real so
      // teardown can delete the ASN cleanly.
      await putawayDialog.getByRole('button', { name: 'Anuluj' }).click()
      await expect(putawayDialog).toBeHidden({ timeout: 10_000 })

      await putawayRow.getByRole('button', { name: /Open actions|Otwórz akcje/i }).click()
      await page.getByRole('menuitem', { name: 'Zakończ' }).click()
      putawayDialog = page.getByRole('dialog').filter({ hasText: 'Zakończ rozlokowanie' }).first()
      await expect(putawayDialog).toBeVisible()
      await putawayDialog.getByTestId('complete-putaway-qty').fill('5')
      await selectLocationComboboxOption(
        page,
        putawayDialog,
        'Wybierz docelową lokalizację',
        binCode,
      )
      const completeResponse = await submitInventoryDialog(page, putawayDialog, {
        submitTestId: 'complete-putaway-submit',
        apiPath: '/api/wms/putaway-tasks/',
      })
      expect(completeResponse.url()).toContain('/complete')
      expect(completeResponse.ok()).toBeTruthy()
      await expect(putawayDialog).toBeHidden({ timeout: 10_000 })
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

  test('shows translated validation errors for an empty Create ASN submission (German)', async ({
    page,
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_asn'],
    )

    const postRequests: string[] = []

    try {
      await login(page, 'admin')
      await setWmsLocale(page, 'de')
      page.on('request', (req) => {
        if (req.method() === 'POST') postRequests.push(req.url())
      })

      await page.goto('/backend/wms/asns')
      await waitForWmsMutationAccess(page)
      await page.getByRole('button', { name: 'Lieferavis erstellen' }).first().click()

      const createDialog = page.getByRole('dialog').filter({ hasText: 'Lieferavis erstellen' }).first()
      await expect(createDialog).toBeVisible()

      // See the Polish test above for why the first submit on a freshly opened dialog is
      // wrapped in `toPass`: it races the ASN mutation-access resolution.
      await expect(async () => {
        await createDialog.getByTestId('create-asn-submit').click()
        await expect(createDialog.getByText('Wählen Sie ein Lager aus.')).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await expect(createDialog.getByText('Wählen Sie eine Variante aus.')).toBeVisible()
      await expect(createDialog.getByText('Invalid UUID')).toHaveCount(0)
      await expect(createDialog.getByText(/Too small/)).toHaveCount(0)
      expect(postRequests.some((url) => url.includes('/api/wms/asns'))).toBe(false)
    } finally {
      await restoreAdminAcl()
    }
  })
})
