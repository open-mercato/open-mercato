import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequest,
  getAuthToken,
  readJsonSafe,
  ensureProductionEnabledToggle,
  createWorkCenter,
  deleteWorkCenterIfExists,
  uniqueName,
} from './helpers/production'

/**
 * TC-PROD-001: Work Center CRUD (API) + backend list UI visibility (task 1.3).
 *
 * Self-contained: creates its own `production_enabled` toggle state (idempotent,
 * see helpers/production.ts) and its own work-center fixture, cleaning the
 * fixture up in `finally`. The toggle itself is treated as shared module
 * infrastructure (like a seeded default) and is not deleted.
 */
test.describe('TC-PROD-001: Work Center CRUD + list UI visibility', () => {
  test('creates, lists, updates, and deletes a work center via the API and sees it in the backend list', async ({ request, page }) => {
    test.setTimeout(60_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    await ensureProductionEnabledToggle(request, superadminToken)

    let workCenterId: string | null = null
    const name = uniqueName('QA Work Center')

    try {
      workCenterId = await createWorkCenter(request, adminToken, { name, kind: 'machine', costRatePerHour: 15 })

      const listResponse = await apiRequest(request, 'GET', `/api/production/work-centers?id=${workCenterId}`, { token: adminToken })
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<{ id?: string; name?: string; updatedAt?: string }> }>(listResponse)
      const record = (listBody?.items ?? []).find((item) => item.id === workCenterId)
      expect(record?.name).toBe(name)
      expect(typeof record?.updatedAt).toBe('string')

      const updateResponse = await apiRequest(request, 'PUT', '/api/production/work-centers', {
        token: adminToken,
        data: { id: workCenterId, costRatePerHour: 20 },
      })
      expect(updateResponse.status()).toBe(200)

      const afterUpdateResponse = await apiRequest(request, 'GET', `/api/production/work-centers?id=${workCenterId}`, { token: adminToken })
      const afterUpdateBody = await readJsonSafe<{ items?: Array<{ id?: string; costRatePerHour?: string }> }>(afterUpdateResponse)
      const updated = (afterUpdateBody?.items ?? []).find((item) => item.id === workCenterId)
      expect(Number(updated?.costRatePerHour)).toBe(20)

      // Backend list UI: the fixture row should render for an authenticated admin.
      await login(page, 'admin')
      await page.goto('/backend/production/work-centers')
      const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) })
      await expect(row).toBeVisible({ timeout: 10_000 })

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/production/work-centers', {
        token: adminToken,
        data: { id: workCenterId },
      })
      expect(deleteResponse.status()).toBe(200)
      const deletedId = workCenterId
      workCenterId = null

      const afterDeleteResponse = await apiRequest(request, 'GET', `/api/production/work-centers?id=${deletedId}`, { token: adminToken })
      const afterDeleteBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(afterDeleteResponse)
      expect((afterDeleteBody?.items ?? []).some((item) => item.id === deletedId)).toBe(false)
    } finally {
      await deleteWorkCenterIfExists(request, adminToken, workCenterId)
    }
  })
})
