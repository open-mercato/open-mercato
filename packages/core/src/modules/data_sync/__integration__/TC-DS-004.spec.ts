import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { isSchedulerUnavailable, readJson, uniqueIntegrationId, type JsonRecord } from './helpers/support'
import { deleteSyncSchedulesByIntegration } from './helpers/db'

/**
 * TC-DS-004: Data sync schedule CRUD APIs
 *
 * Implements issue #2475 scenario "TC-DS-003 — Schedule CRUD operations"
 * (renumbered: TC-DS-003 is already used by the options-endpoint smoke test).
 *
 * Exercises POST/GET/PUT/DELETE for `/api/data_sync/schedules`. Schedule writes
 * delegate to the optional `scheduler` module; when it is not registered the API
 * returns 422 ("Scheduler module is not available") and the test self-skips.
 * Cleanup hard-deletes by the per-run-unique integration id.
 */

test.describe('TC-DS-004: Data sync schedule CRUD APIs', () => {
  test('create, read, update, and delete a sync schedule', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const integrationId = uniqueIntegrationId('test_ds004')

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/data_sync/schedules', {
        token,
        data: {
          integrationId,
          entityType: 'catalog.product',
          direction: 'import',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          timezone: 'UTC',
        },
      })
      const createBody = await readJson(createResponse)
      if (createResponse.status() === 422 && isSchedulerUnavailable(createBody)) {
        test.skip(true, 'Scheduler module not available — skipping schedule CRUD tests')
        return
      }

      expect(createResponse.status()).toBe(201)
      const scheduleId = String(createBody.id)
      expect(scheduleId).toMatch(/^[0-9a-f-]{36}$/i)
      expect(createBody.integrationId).toBe(integrationId)
      expect(createBody.entityType).toBe('catalog.product')
      expect(createBody.direction).toBe('import')
      expect(createBody.scheduleType).toBe('cron')
      expect(createBody.scheduleValue).toBe('0 0 * * *')
      expect(createBody.timezone).toBe('UTC')
      expect(createBody.fullSync).toBe(false)
      expect(createBody.isEnabled).toBe(true)
      expect(typeof createBody.createdAt).toBe('string')
      expect(typeof createBody.updatedAt).toBe('string')

      // List schedules — created schedule must appear with the paginated envelope
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/data_sync/schedules?integrationId=${integrationId}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJson(listResponse)
      expect(Array.isArray(listBody.items)).toBe(true)
      const listItems = listBody.items as JsonRecord[]
      expect(listItems.map((item) => String(item.id))).toContain(scheduleId)
      expect(listBody).toHaveProperty('total')
      expect(listBody.page).toBe(1)
      expect(typeof listBody.pageSize).toBe('number')
      expect(typeof listBody.totalPages).toBe('number')

      // Get by id — full object
      const getResponse = await apiRequest(request, 'GET', `/api/data_sync/schedules/${scheduleId}`, { token })
      expect(getResponse.status()).toBe(200)
      const getBody = await readJson(getResponse)
      expect(getBody.id).toBe(scheduleId)
      expect(getBody.integrationId).toBe(integrationId)
      expect(getBody.scheduleValue).toBe('0 0 * * *')
      expect(getBody.timezone).toBe('UTC')

      // Update timezone
      const updateResponse = await apiRequest(request, 'PUT', `/api/data_sync/schedules/${scheduleId}`, {
        token,
        data: { timezone: 'America/New_York' },
      })
      expect(updateResponse.status()).toBe(200)
      const updateBody = await readJson(updateResponse)
      expect(updateBody.id).toBe(scheduleId)
      expect(updateBody.timezone).toBe('America/New_York')
      expect(new Date(String(updateBody.updatedAt)).getTime()).toBeGreaterThanOrEqual(
        new Date(String(createBody.createdAt)).getTime(),
      )

      // Verify update persisted
      const verifyResponse = await apiRequest(request, 'GET', `/api/data_sync/schedules/${scheduleId}`, { token })
      expect(verifyResponse.status()).toBe(200)
      const verifyBody = await readJson(verifyResponse)
      expect(verifyBody.timezone).toBe('America/New_York')

      // Delete (also unregisters the scheduler job)
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/data_sync/schedules/${scheduleId}`, { token })
      expect(deleteResponse.status()).toBe(200)
      const deleteBody = await readJson(deleteResponse)
      expect(deleteBody.deleted).toBe(true)

      // Subsequent get returns 404
      const afterDeleteResponse = await apiRequest(request, 'GET', `/api/data_sync/schedules/${scheduleId}`, { token })
      expect(afterDeleteResponse.status()).toBe(404)
    } finally {
      await deleteSyncSchedulesByIntegration(integrationId)
    }
  })
})
