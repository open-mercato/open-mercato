import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_EXECUTION_QUEUE, SCHEDULER_JOBS_PATH, uniqueScheduleName } from './helpers/scheduler'

type ValidationError = { error?: string; details?: Array<{ path?: Array<string | number> }> }

/**
 * TC-SCHED-007: POST /api/scheduler/jobs rejects invalid cron and interval
 * `scheduleValue`s with 400 and an error scoped to the `scheduleValue` path.
 *
 * Interval format is `<number><unit>` with unit in s|m|h|d and a minimum floor
 * of one minute. All cases are rejected at validation, so no records are
 * created and no teardown is required.
 */
const invalidCases = [
  { label: 'cron: not a cron expression', scheduleType: 'cron' as const, scheduleValue: 'not-a-cron' },
  { label: 'cron: too few fields', scheduleType: 'cron' as const, scheduleValue: '* * *' },
  { label: 'interval: unsupported unit', scheduleType: 'interval' as const, scheduleValue: '15x' },
  { label: 'interval: missing unit', scheduleType: 'interval' as const, scheduleValue: '99' },
  { label: 'interval: zero seconds', scheduleType: 'interval' as const, scheduleValue: '0s' },
  { label: 'interval: one second', scheduleType: 'interval' as const, scheduleValue: '1s' },
  { label: 'interval: below one minute', scheduleType: 'interval' as const, scheduleValue: '59s' },
]

test.describe('TC-SCHED-007: POST /api/scheduler/jobs validates schedule value format', () => {
  for (const testCase of invalidCases) {
    test(`rejects ${testCase.label} with 400 on scheduleValue`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')

      const response = await apiRequest(request, 'POST', SCHEDULER_JOBS_PATH, {
        token,
        data: {
          name: uniqueScheduleName('Invalid Schedule Value'),
          scopeType: 'organization',
          scheduleType: testCase.scheduleType,
          scheduleValue: testCase.scheduleValue,
          timezone: 'UTC',
          targetType: 'queue',
          targetQueue: SCHEDULER_EXECUTION_QUEUE,
          isEnabled: true,
          sourceType: 'user',
        },
      })

      expect(response.status(), `${testCase.label} should be rejected with 400`).toBe(400)
      const body = await readJsonSafe<ValidationError>(response)
      const issuePaths = (body?.details ?? []).map((issue) => (issue.path ?? []).join('.'))
      expect(issuePaths, `${testCase.label} error should target scheduleValue`).toContain('scheduleValue')
    })
  }
})
