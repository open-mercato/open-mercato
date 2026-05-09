import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  fillControlledInput,
  waitForApiMutation,
} from '@open-mercato/core/helpers/integration/ui'
import {
  ensureRoleFeatures,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms'],
}

test.describe('TC-WMS-020: ACL denial and warehouse UI CRUD', () => {
  test('should deny employee warehouse mutations without WMS permissions', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')

    const response = await apiRequest(request, 'POST', '/api/wms/warehouses', {
      token: employeeToken,
      data: {
        name: 'TC-WMS-020 Forbidden Warehouse',
        code: `TCW20${Date.now()}`,
        city: 'Wroclaw',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      },
    })

    expect(response.status()).toBe(403)
  })

  test('should create, edit, and archive a warehouse from the dedicated backend page', async ({
    page,
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_warehouses'],
    )

    const warehouseName = `TC-WMS-020 UI ${stamp}`
    const warehouseCode = `TCW20UI${stamp}`
    let warehouseId: string | null = null

    try {
      await login(page, 'admin')
      await page.goto('/backend/config/wms')

      await page.getByRole('button', { name: /Add warehouse/i }).click()
      const createDialog = page.getByRole('dialog').filter({ hasText: /Create warehouse/i }).first()
      await expect(createDialog).toBeVisible()
      const createInputs = createDialog.getByRole('textbox')

      await fillControlledInput(createInputs.nth(0), warehouseName)
      await fillControlledInput(createInputs.nth(1), warehouseCode)
      await fillControlledInput(createInputs.nth(2), 'Gdynia')
      await fillControlledInput(createInputs.nth(3), 'PL')
      await fillControlledInput(createInputs.nth(4), 'Europe/Warsaw')

      const createResponse = await waitForApiMutation(
        page,
        '/api/wms/warehouses',
        async () => {
          await createDialog.getByRole('button', { name: /^Save$/i }).click()
        },
        'POST',
        20_000,
      )
      expect(createResponse.ok()).toBeTruthy()

      const row = page.getByRole('row').filter({ hasText: warehouseCode })
      await expect(row).toBeVisible({ timeout: 15_000 })
      const createPayload = (await createResponse.json().catch(() => null)) as { id?: string } | null
      warehouseId = createPayload?.id ?? null

      const actionsButton = row.getByRole('button', { name: 'Open actions' })
      await actionsButton.focus()
      await actionsButton.press('Enter')
      await page.getByRole('menuitem', { name: /^Edit$/i }).click()

      const editDialog = page.getByRole('dialog').filter({ hasText: /Edit warehouse/i }).first()
      await expect(editDialog).toBeVisible()
      await fillControlledInput(editDialog.getByRole('textbox').nth(2), 'Krakow')

      const updateResponse = await waitForApiMutation(
        page,
        '/api/wms/warehouses',
        async () => {
          await editDialog.getByRole('button', { name: /^Save$/i }).click()
        },
        'PUT',
        20_000,
      )
      expect(updateResponse.ok()).toBeTruthy()
      await expect(row).toContainText('Krakow')

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
      expect(deleteResponse.ok()).toBeTruthy()
      await expect(row).toHaveCount(0, { timeout: 15_000 })
      warehouseId = null
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await restoreAdminAcl()
    }
  })
})
