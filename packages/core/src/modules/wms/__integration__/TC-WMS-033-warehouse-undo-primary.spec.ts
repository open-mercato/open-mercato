import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/helpers/integration/ui'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'audit_logs'],
}

/**
 * TC-WMS-033
 *
 * Undoing a warehouse update or create must keep at most one primary warehouse
 * per organization instead of failing on the one-primary unique index:
 * - restoring the undone warehouse's own primary flag demotes the warehouse
 *   that became primary since;
 * - a sibling demoted by the undone change is re-promoted only while no other
 *   warehouse has taken the primary flag since.
 *
 * The last case drives the same flow from the warehouse edit dialog and the
 * operation banner's Undo button.
 *
 * Self-contained: creates its own warehouses, deletes them in finally and
 * re-promotes the organization's original primary warehouse.
 */

const WAREHOUSES_PATH = '/api/wms/warehouses'

type WarehouseRow = { id?: string; is_primary?: boolean | null; is_active?: boolean | null }

async function listWarehouses(request: APIRequestContext, token: string): Promise<WarehouseRow[]> {
  const rows: WarehouseRow[] = []
  for (let page = 1; page <= 20; page += 1) {
    const response = await apiRequest(request, 'GET', `${WAREHOUSES_PATH}?page=${page}&pageSize=100`, { token })
    expect(response.ok(), `GET ${WAREHOUSES_PATH} failed: ${response.status()}`).toBeTruthy()
    const body = await readJsonSafe<{ items?: WarehouseRow[]; totalPages?: number }>(response)
    rows.push(...(body?.items ?? []))
    if (page >= (body?.totalPages ?? 1)) break
  }
  return rows
}

async function primaryWarehouseIds(request: APIRequestContext, token: string): Promise<string[]> {
  const rows = await listWarehouses(request, token)
  return rows.filter((row) => row.is_primary === true).map((row) => String(row.id))
}

async function createWarehouse(
  request: APIRequestContext,
  token: string,
  stamp: string,
  suffix: string,
  isPrimary: boolean,
): Promise<string> {
  return createCrudFixture(request, token, WAREHOUSES_PATH, {
    name: `QA Undo Primary ${suffix} ${stamp}`,
    code: `QAUP-${suffix}-${stamp}`,
    isActive: true,
    isPrimary,
  })
}

async function restoreOriginalPrimary(
  request: APIRequestContext,
  token: string,
  originalPrimaryIds: string[],
): Promise<void> {
  if (!originalPrimaryIds[0]) return
  const response = await apiRequest(request, 'PUT', WAREHOUSES_PATH, {
    token,
    data: { id: originalPrimaryIds[0], isPrimary: true },
  })
  expect.soft(response.ok(), `re-promoting the original primary warehouse: ${response.status()}`).toBeTruthy()
}

async function updateWarehouse(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
) {
  const response = await apiRequest(request, 'PUT', WAREHOUSES_PATH, { token, data })
  expect(response.status(), `PUT ${WAREHOUSES_PATH} ${JSON.stringify(data)}`).toBe(200)
  return response
}

test.describe('TC-WMS-033: warehouse undo keeps one primary warehouse per organization', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('undoing the deactivation of a primary warehouse restores it and demotes the newer primary', async ({ request }) => {
    const stamp = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()
    let token: string | null = null
    let originalPrimaryIds: string[] = []
    const created: string[] = []

    try {
      token = await getAuthToken(request)
      originalPrimaryIds = await primaryWarehouseIds(request, token)

      const first = await createWarehouse(request, token, stamp, 'A', true)
      created.push(first)
      const second = await createWarehouse(request, token, stamp, 'B', false)
      created.push(second)
      expect(await primaryWarehouseIds(request, token)).toEqual([first])

      const deactivateResponse = await updateWarehouse(request, token, { id: first, isActive: false })
      const deactivateOp = expectOperation(deactivateResponse, 'wms.warehouses.update')
      expect(await primaryWarehouseIds(request, token)).toEqual([])

      await updateWarehouse(request, token, { id: second, isPrimary: true })
      expect(await primaryWarehouseIds(request, token)).toEqual([second])

      await undoOk(request, token, deactivateOp.undoToken, 'undo of the primary warehouse deactivation')

      const rows = await listWarehouses(request, token)
      const restored = rows.find((row) => row.id === first)
      expect(restored?.is_active, 'undo reactivates the warehouse').toBe(true)
      expect(rows.filter((row) => row.is_primary === true).map((row) => row.id)).toEqual([first])
    } finally {
      for (const id of created) {
        await deleteGeneralEntityIfExists(request, token, WAREHOUSES_PATH, id)
      }
      if (token) await restoreOriginalPrimary(request, token, originalPrimaryIds)
    }
  })

  test('undoing a primary promotion keeps a warehouse promoted since as the primary', async ({ request }) => {
    const stamp = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()
    let token: string | null = null
    let originalPrimaryIds: string[] = []
    const created: string[] = []

    try {
      token = await getAuthToken(request)
      originalPrimaryIds = await primaryWarehouseIds(request, token)

      const first = await createWarehouse(request, token, stamp, 'A', true)
      created.push(first)
      const second = await createWarehouse(request, token, stamp, 'B', false)
      created.push(second)
      const third = await createWarehouse(request, token, stamp, 'C', false)
      created.push(third)

      const promoteResponse = await updateWarehouse(request, token, { id: second, isPrimary: true })
      const promoteOp = expectOperation(promoteResponse, 'wms.warehouses.update')
      expect(await primaryWarehouseIds(request, token)).toEqual([second])

      await updateWarehouse(request, token, { id: third, isPrimary: true })
      expect(await primaryWarehouseIds(request, token)).toEqual([third])

      await undoOk(request, token, promoteOp.undoToken, 'undo of the earlier primary promotion')

      expect(await primaryWarehouseIds(request, token)).toEqual([third])
    } finally {
      for (const id of created) {
        await deleteGeneralEntityIfExists(request, token, WAREHOUSES_PATH, id)
      }
      if (token) await restoreOriginalPrimary(request, token, originalPrimaryIds)
    }
  })

  test('undo from the operation banner restores a deactivated primary warehouse', async ({ page, request }) => {
    test.slow()
    const stamp = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    let restoreAdminAcl: (() => Promise<void>) | null = null
    let originalPrimaryIds: string[] = []
    const created: string[] = []

    try {
      restoreAdminAcl = await ensureRoleFeatures(
        request,
        superadminToken,
        getTokenScope(adminToken).tenantId,
        'admin',
        ['wms.view', 'wms.manage_warehouses'],
      )
      originalPrimaryIds = await primaryWarehouseIds(request, adminToken)
      const first = await createWarehouse(request, adminToken, stamp, 'A', true)
      created.push(first)
      const second = await createWarehouse(request, adminToken, stamp, 'B', false)
      created.push(second)

      await login(page, 'admin')
      await page.goto('/backend/wms/warehouses')
      await fillControlledInput(page.getByPlaceholder('Search warehouses').first(), `QAUP-A-${stamp}`)
      const row = page.getByRole('row').filter({ hasText: `QAUP-A-${stamp}` })
      await expect(row).toBeVisible({ timeout: 15_000 })

      const actionsButton = row.getByRole('button', { name: 'Open actions' })
      await actionsButton.focus()
      await actionsButton.press('Enter')
      await page.getByRole('menuitem', { name: /^Edit$/i }).click()
      const editDialog = page.getByRole('dialog').filter({ hasText: /Edit warehouse/i }).first()
      await expect(editDialog).toBeVisible()
      await editDialog.locator('[data-crud-field-id="isPrimary"]').getByRole('checkbox').uncheck()
      await editDialog.locator('[data-crud-field-id="isActive"]').getByRole('checkbox').uncheck()
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
      expect(await primaryWarehouseIds(request, adminToken)).toEqual([])

      await updateWarehouse(request, adminToken, { id: second, isPrimary: true })
      expect(await primaryWarehouseIds(request, adminToken)).toEqual([second])

      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ })
      await expect(undoButton).toBeVisible()
      const undoResponse = await waitForApiMutation(
        page,
        '/api/audit_logs/audit-logs/actions/undo',
        async () => {
          await undoButton.click()
        },
        'POST',
        20_000,
      )
      expect(undoResponse.status(), 'banner undo succeeds').toBe(200)
      await expect.poll(async () => primaryWarehouseIds(request, adminToken), { timeout: 10_000 }).toEqual([first])
    } finally {
      for (const id of created) {
        await deleteGeneralEntityIfExists(request, adminToken, WAREHOUSES_PATH, id)
      }
      await restoreOriginalPrimary(request, adminToken, originalPrimaryIds)
      await restoreAdminAcl?.()
    }
  })
})
