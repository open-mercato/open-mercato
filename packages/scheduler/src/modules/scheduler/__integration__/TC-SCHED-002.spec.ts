import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  SCHEDULER_JOBS_PATH,
  createScheduleJob,
  deleteScheduleJob,
  getScheduleJobById,
  uniqueScheduleName,
} from './helpers/scheduler'

/**
 * TC-SCHED-002: PUT /api/scheduler/jobs updates schedule fields correctly
 *
 * Note: scheduleUpdateSchema requires `scheduleType` whenever `scheduleValue`
 * changes, so the update payload sends both (the issue's draft omitted the
 * type — the route rejects that with 400). This asserts the real contract.
 */
test.describe('TC-SCHED-002: PUT /api/scheduler/jobs updates schedule fields', () => {
  test('updates name and scheduleValue while preserving identity and scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null

    try {
      scheduleId = await createScheduleJob(request, token, {
        name: uniqueScheduleName('Sched Update'),
        scheduleType: 'interval',
        scheduleValue: '15m',
      })

      const original = await getScheduleJobById(request, token, scheduleId)
      expect(original).not.toBeNull()
      expect(original!.scheduleValue).toBe('15m')

      const updateResponse = await apiRequest(request, 'PUT', SCHEDULER_JOBS_PATH, {
        token,
        data: { id: scheduleId, name: 'Updated-Test-1', scheduleType: 'interval', scheduleValue: '30m' },
      })
      expect(updateResponse.status()).toBe(200)
      const updateBody = await readJsonSafe<{ ok?: boolean }>(updateResponse)
      expect(updateBody?.ok).toBe(true)

      const updated = await getScheduleJobById(request, token, scheduleId)
      expect(updated).not.toBeNull()
      // Mutated fields persisted
      expect(updated!.name).toBe('Updated-Test-1')
      expect(updated!.scheduleValue).toBe('30m')
      // Identity and scope unchanged
      expect(updated!.id).toBe(scheduleId)
      expect(updated!.tenantId).toBe(original!.tenantId)
      expect(updated!.organizationId).toBe(original!.organizationId)
      expect(updated!.targetQueue).toBe(original!.targetQueue)
      // updatedAt advances past the original creation timestamp
      if (original!.createdAt && updated!.updatedAt) {
        expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(original!.createdAt).getTime(),
        )
      }
    } finally {
      await deleteScheduleJob(request, token, scheduleId)
    }
  })
})
