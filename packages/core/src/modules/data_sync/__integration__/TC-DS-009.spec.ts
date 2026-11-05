import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { isSchedulerUnavailable, readJson, uniqueIntegrationId } from './helpers/support'
import { deleteSyncSchedulesByIntegration } from './helpers/db'

/**
 * TC-DS-009: Schedule create validation (schema + cron/interval expression)
 *
 * Implements issue #2475 scenario "TC-DS-008 — Schedule create with invalid cron
 * expression" (renumbered to avoid existing TC-DS files).
 *
 * Two validation layers return 422:
 *  - the zod `createSyncScheduleSchema` (empty value, missing field, bad enum), and
 *  - the scheduler's cron/interval parser, invoked when the schedule is registered.
 * The cron/interval cases depend on the optional `scheduler` module and self-skip
 * when it is unavailable. A malformed expression persists a row before the parser
 * throws, so cleanup hard-deletes by integration id.
 */

const SCHEDULE_PATH = '/api/data_sync/schedules'

test.describe('TC-DS-009: Data sync schedule validation', () => {
  test('rejects payloads that fail schema validation with 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    // Empty scheduleValue (zod .min(1)) — rejected before the service runs
    const emptyValue = await apiRequest(request, 'POST', SCHEDULE_PATH, {
      token,
      data: {
        integrationId: uniqueIntegrationId('test_ds009_empty'),
        entityType: 'catalog.product',
        direction: 'import',
        scheduleType: 'cron',
        scheduleValue: '',
      },
    })
    expect(emptyValue.status()).toBe(422)

    // Missing required integrationId
    const missingField = await apiRequest(request, 'POST', SCHEDULE_PATH, {
      token,
      data: {
        entityType: 'catalog.product',
        direction: 'import',
        scheduleType: 'cron',
        scheduleValue: '0 0 * * *',
      },
    })
    expect(missingField.status()).toBe(422)

    // Invalid scheduleType enum
    const badType = await apiRequest(request, 'POST', SCHEDULE_PATH, {
      token,
      data: {
        integrationId: uniqueIntegrationId('test_ds009_enum'),
        entityType: 'catalog.product',
        direction: 'import',
        scheduleType: 'weekly',
        scheduleValue: '0 0 * * *',
      },
    })
    expect(badType.status()).toBe(422)
  })

  test('rejects invalid cron and interval expressions with 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const cronIntegration = uniqueIntegrationId('test_ds009_cron')
    const intervalIntegration = uniqueIntegrationId('test_ds009_interval')
    const validIntegration = uniqueIntegrationId('test_ds009_valid')

    try {
      // Valid baseline first — also probes scheduler availability
      const validRes = await apiRequest(request, 'POST', SCHEDULE_PATH, {
        token,
        data: {
          integrationId: validIntegration,
          entityType: 'catalog.product',
          direction: 'import',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          timezone: 'UTC',
        },
      })
      const validBody = await readJson(validRes)
      if (validRes.status() === 422 && isSchedulerUnavailable(validBody)) {
        test.skip(true, 'Scheduler module not available — cron/interval validation lives in the scheduler')
        return
      }
      expect(validRes.status()).toBe(201)
      const validId = String(validBody.id)

      // Invalid cron expression — rejected by the scheduler's cron parser
      const badCron = await apiRequest(request, 'POST', SCHEDULE_PATH, {
        token,
        data: {
          integrationId: cronIntegration,
          entityType: 'catalog.product',
          direction: 'import',
          scheduleType: 'cron',
          scheduleValue: 'invalid cron!@#',
          timezone: 'UTC',
        },
      })
      expect(badCron.status()).toBe(422)

      // Invalid interval expression — rejected by the scheduler's interval parser
      const badInterval = await apiRequest(request, 'POST', SCHEDULE_PATH, {
        token,
        data: {
          integrationId: intervalIntegration,
          entityType: 'catalog.product',
          direction: 'import',
          scheduleType: 'interval',
          scheduleValue: 'not-a-number',
          timezone: 'UTC',
        },
      })
      expect(badInterval.status()).toBe(422)

      // Clean up the valid schedule through the API so the scheduler job is unregistered
      const deleteValid = await apiRequest(request, 'DELETE', `${SCHEDULE_PATH}/${validId}`, { token })
      expect(deleteValid.status()).toBe(200)
    } finally {
      await deleteSyncSchedulesByIntegration(cronIntegration)
      await deleteSyncSchedulesByIntegration(intervalIntegration)
      await deleteSyncSchedulesByIntegration(validIntegration)
    }
  })
})
