import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_JOBS_PATH, createScheduleJob, deleteScheduleJob, getScheduleJobById } from './helpers/scheduler'

/**
 * TC-SCHED-003: DELETE /api/scheduler/jobs soft-deletes a schedule and
 * prevents re-listing. The list endpoint keeps returning 200 (not 404) with
 * the soft-deleted record filtered out by the `deletedAt` soft-delete field.
 */
test.describe('TC-SCHED-003: DELETE /api/scheduler/jobs soft-deletes a schedule', () => {
  test('removes the schedule from listings and returns 200 (not 404) afterwards', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null
    let deleted = false

    try {
      scheduleId = await createScheduleJob(request, token)

      const present = await getScheduleJobById(request, token, scheduleId)
      expect(present).not.toBeNull()

      const deleteResponse = await apiRequest(request, 'DELETE', SCHEDULER_JOBS_PATH, {
        token,
        data: { id: scheduleId },
      })
      expect(deleteResponse.status()).toBe(200)
      const deleteBody = await readJsonSafe<{ ok?: boolean }>(deleteResponse)
      expect(deleteBody?.ok).toBe(true)
      deleted = true

      // Soft delete: list still returns 200 with an (empty) items array, never 404.
      const afterResponse = await apiRequest(
        request,
        'GET',
        `${SCHEDULER_JOBS_PATH}?id=${encodeURIComponent(scheduleId)}`,
        { token },
      )
      expect(afterResponse.status()).toBe(200)
      const afterBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(afterResponse)
      expect(Array.isArray(afterBody?.items)).toBe(true)
      expect((afterBody?.items ?? []).some((item) => item.id === scheduleId)).toBe(false)
      expect((afterBody?.items ?? []).length).toBe(0)
    } finally {
      if (!deleted) await deleteScheduleJob(request, token, scheduleId)
    }
  })
})
