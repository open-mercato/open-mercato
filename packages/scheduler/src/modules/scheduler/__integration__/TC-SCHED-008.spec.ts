import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_TRIGGER_PATH, createScheduleJob, deleteScheduleJob, uniqueScheduleName } from './helpers/scheduler'

const isAsyncQueueStrategy = (process.env.QUEUE_STRATEGY || 'local') === 'async'

type TriggerBody = { ok?: boolean; jobId?: string; error?: string; message?: string }

/**
 * TC-SCHED-008: POST /api/scheduler/trigger resolves the scope of a system-scoped
 * schedule on the loaded row, not in the lookup.
 *
 * A system-scoped schedule has `tenantId === null` and `organizationId === null`. When the
 * route folded the caller's tenant/org into the `where` clause, no such row could ever match
 * and every caller — super admins included — got 404, which also masked the route's own
 * super-admin gate. A super admin must now reach the schedule, and a non-super-admin must be
 * told 403 rather than 404.
 *
 * The super-admin assertion holds under either queue strategy: the `QUEUE_STRATEGY=async`
 * check sits after the lookup, so `local` yields the pre-existing 400 — never 404.
 */
test.describe('TC-SCHED-008: manual trigger of a system-scoped schedule', () => {
  test('super admin reaches the schedule; a non-super-admin is forbidden', async ({ request }) => {
    const superToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null

    try {
      // Creating a system-scoped schedule is itself super-admin only.
      scheduleId = await createScheduleJob(request, superToken, {
        name: uniqueScheduleName('System-Trigger-Test'),
        scopeType: 'system',
        scheduleType: 'interval',
        scheduleValue: '1h',
      })

      const superResponse = await apiRequest(request, 'POST', SCHEDULER_TRIGGER_PATH, {
        token: superToken,
        data: { id: scheduleId },
      })
      const superBody = await readJsonSafe<TriggerBody>(superResponse)
      expect(
        superResponse.status(),
        'a super admin must not be told a system-scoped schedule does not exist',
      ).not.toBe(404)

      if (isAsyncQueueStrategy) {
        expect(superResponse.status()).toBe(200)
        expect(superBody?.ok).toBe(true)
        expect(typeof superBody?.jobId === 'string' && superBody.jobId.length > 0).toBe(true)
      } else {
        // The strategy check runs after the scope check, so this is the 404 used to mask.
        expect(superResponse.status()).toBe(400)
        expect(superBody?.error ?? '').toMatch(/async/i)
      }

      // The same schedule is visible enough to be refused, not hidden, from a tenant admin.
      const adminResponse = await apiRequest(request, 'POST', SCHEDULER_TRIGGER_PATH, {
        token: adminToken,
        data: { id: scheduleId },
      })
      expect(
        adminResponse.status(),
        'a non-super-admin must be forbidden from triggering a system-scoped schedule',
      ).toBe(403)
    } finally {
      await deleteScheduleJob(request, superToken, scheduleId)
    }
  })
})
