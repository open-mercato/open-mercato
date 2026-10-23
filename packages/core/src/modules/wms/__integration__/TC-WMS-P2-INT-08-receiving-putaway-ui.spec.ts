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
  selectLocationComboboxOption,
  submitInventoryDialog,
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
})
