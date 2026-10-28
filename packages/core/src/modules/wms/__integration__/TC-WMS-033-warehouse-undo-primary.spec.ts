import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { createCrudFixture } from './helpers/wmsFixtures'

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
      if (token && originalPrimaryIds[0]) {
        await apiRequest(request, 'PUT', WAREHOUSES_PATH, { token, data: { id: originalPrimaryIds[0], isPrimary: true } })
      }
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
      if (token && originalPrimaryIds[0]) {
        await apiRequest(request, 'PUT', WAREHOUSES_PATH, { token, data: { id: originalPrimaryIds[0], isPrimary: true } })
      }
    }
  })
})
