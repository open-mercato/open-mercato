import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  SCHEDULER_FORBIDDEN_INTERNAL_QUEUES,
  SCHEDULER_JOBS_PATH,
  SCHEDULER_TARGETS_PATH,
  createScheduleJob,
  deleteScheduleJob,
  getScheduleJobById,
  uniqueScheduleName,
} from './helpers/scheduler'

/**
 * TC-SCHED-008: Scheduler queue targets are restricted to authorized safe
 * workers (#5213). A principal holding only `scheduler.jobs.manage` must not be
 * able to aim a schedule at an internal/system worker queue with an arbitrary
 * payload — neither at creation, nor by retargeting later.
 */
test.describe('TC-SCHED-008: scheduler queue targets restricted to safe workers', () => {
  for (const forbiddenQueue of SCHEDULER_FORBIDDEN_INTERNAL_QUEUES) {
    test(`rejects creating a schedule targeting the ${forbiddenQueue} worker`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')

      const response = await apiRequest(request, 'POST', SCHEDULER_JOBS_PATH, {
        token,
        data: {
          name: uniqueScheduleName('Forbidden Queue Target'),
          scopeType: 'organization',
          scheduleType: 'interval',
          scheduleValue: '15m',
          timezone: 'UTC',
          targetType: 'queue',
          targetQueue: forbiddenQueue,
          targetPayload: { scope: { tenantId: 'forged', organizationId: 'forged' } },
          isEnabled: true,
          sourceType: 'user',
        },
      })

      expect(response.status(), `${forbiddenQueue} must not be schedulable`).toBe(400)
      const body = await readJsonSafe<{ error?: string; details?: Array<{ path?: Array<string | number> }> }>(response)
      const issuePaths = (body?.details ?? []).map((issue) => (issue.path ?? []).join('.'))
      expect(issuePaths).toContain('targetQueue')
    })
  }

  test('rejects retargeting an existing schedule to an internal worker queue', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null

    try {
      scheduleId = await createScheduleJob(request, token, { name: uniqueScheduleName('Retarget Guard') })

      const response = await apiRequest(request, 'PUT', SCHEDULER_JOBS_PATH, {
        token,
        data: {
          id: scheduleId,
          targetType: 'queue',
          targetQueue: 'stripe-webhook',
        },
      })

      // Enforcement lives in the update command (change-detection vs the stored
      // row), so an actual retarget lands as 422 with the approval error.
      expect(response.status()).toBe(422)
      const body = await readJsonSafe<{ error?: string }>(response)
      expect(body?.error ?? '').toMatch(/not an approved scheduler target/i)

      const unchanged = await getScheduleJobById(request, token, scheduleId)
      expect(unchanged).not.toBeNull()
      expect(unchanged!.targetType).toBe('command')
    } finally {
      await deleteScheduleJob(request, token, scheduleId)
    }
  })

  test('targets endpoint keeps internal worker queues undiscoverable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', SCHEDULER_TARGETS_PATH, { token })
    expect(response.status()).toBe(200)

    const body = await readJsonSafe<{ queues?: Array<{ value: string }> }>(response)
    const values = (body?.queues ?? []).map((queue) => queue.value)
    for (const forbidden of SCHEDULER_FORBIDDEN_INTERNAL_QUEUES) {
      expect(values).not.toContain(forbidden)
    }
  })
})
