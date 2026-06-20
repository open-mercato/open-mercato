import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { BASE_URL, isSchedulerUnavailable, readJson, uniqueIntegrationId } from './helpers/support'
import { deleteSyncSchedulesByIntegration } from './helpers/db'

/**
 * TC-DS-006: Authorization enforcement on schedule endpoints
 *
 * Implements issue #2475 scenario "TC-DS-005 — Authorization enforcement on
 * schedule endpoints" (renumbered to avoid the existing TC-DS files).
 *
 * Schedule endpoints require the `data_sync.configure` feature. The seeded
 * `employee` role holds `data_sync.view` but NOT `data_sync.configure`, so it is
 * rejected with 403. `requireFeatures` is enforced before the handler runs, so
 * employee 403s land even on fabricated ids without touching the database.
 */

const SCHEDULE_PATH = '/api/data_sync/schedules'

test.describe('TC-DS-006: Data sync schedule authorization', () => {
  test('unauthenticated requests are rejected with 401', async ({ request }) => {
    const getResponse = await request.get(`${BASE_URL}${SCHEDULE_PATH}`)
    expect(getResponse.status()).toBe(401)

    const postResponse = await request.post(`${BASE_URL}${SCHEDULE_PATH}`, {
      data: {
        integrationId: 'unauthenticated',
        entityType: 'catalog.product',
        direction: 'import',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
      },
    })
    expect(postResponse.status()).toBe(401)

    const putResponse = await request.put(`${BASE_URL}${SCHEDULE_PATH}/${randomUUID()}`, {
      data: { timezone: 'UTC' },
    })
    expect(putResponse.status()).toBe(401)

    const deleteResponse = await request.delete(`${BASE_URL}${SCHEDULE_PATH}/${randomUUID()}`)
    expect(deleteResponse.status()).toBe(401)
  })

  test('employee without data_sync.configure is rejected with 403', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')

    const getResponse = await apiRequest(request, 'GET', SCHEDULE_PATH, { token: employeeToken })
    expect(getResponse.status()).toBe(403)

    const postResponse = await apiRequest(request, 'POST', SCHEDULE_PATH, {
      token: employeeToken,
      data: {
        integrationId: 'employee-forbidden',
        entityType: 'catalog.product',
        direction: 'import',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
      },
    })
    expect(postResponse.status()).toBe(403)

    // requireFeatures runs before the handler, so a fabricated id still 403s (not 404)
    const putResponse = await apiRequest(request, 'PUT', `${SCHEDULE_PATH}/${randomUUID()}`, {
      token: employeeToken,
      data: { timezone: 'UTC' },
    })
    expect(putResponse.status()).toBe(403)

    const deleteResponse = await apiRequest(request, 'DELETE', `${SCHEDULE_PATH}/${randomUUID()}`, {
      token: employeeToken,
    })
    expect(deleteResponse.status()).toBe(403)
  })

  test('admin with data_sync.configure can read and manage schedules', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Read access is always available to admin (no scheduler dependency)
    const listResponse = await apiRequest(request, 'GET', SCHEDULE_PATH, { token })
    expect(listResponse.status()).toBe(200)

    // Positive write baseline (create/update/delete) needs the scheduler module.
    const integrationId = uniqueIntegrationId('test_ds006')
    try {
      const createResponse = await apiRequest(request, 'POST', SCHEDULE_PATH, {
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
        // 401/403 enforcement above is the security-critical surface; the positive
        // write path is environment-dependent and covered by TC-DS-004.
        return
      }
      expect(createResponse.status()).toBe(201)
      const scheduleId = String(createBody.id)

      const updateResponse = await apiRequest(request, 'PUT', `${SCHEDULE_PATH}/${scheduleId}`, {
        token,
        data: { timezone: 'UTC' },
      })
      expect(updateResponse.status()).toBe(200)

      const deleteResponse = await apiRequest(request, 'DELETE', `${SCHEDULE_PATH}/${scheduleId}`, { token })
      expect(deleteResponse.status()).toBe(200)
    } finally {
      await deleteSyncSchedulesByIntegration(integrationId)
    }
  })
})
