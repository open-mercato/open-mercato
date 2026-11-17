import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_JOBS_PATH, createScheduleJob, deleteScheduleJob } from './helpers/scheduler'

const ONE_HOUR_MS = 60 * 60 * 1000

async function readRunTimes(
  request: Parameters<typeof getAuthToken>[0],
  token: string,
  id: string,
): Promise<{ nextRunAt: number; updatedAt: number }> {
  const response = await apiRequest(
    request,
    'GET',
    `${SCHEDULER_JOBS_PATH}?id=${encodeURIComponent(id)}&probe=${Date.now()}`,
    { token },
  )
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{
    items?: Array<{ id: string; nextRunAt: string | null; updatedAt: string | null }>
  }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === id)
  expect(item?.nextRunAt, 'schedule should expose nextRunAt').toBeTruthy()
  expect(item?.updatedAt, 'schedule should expose updatedAt').toBeTruthy()
  return {
    nextRunAt: new Date(String(item?.nextRunAt)).getTime(),
    updatedAt: new Date(String(item?.updatedAt)).getTime(),
  }
}

/**
 * TC-SCHED-011: enabling a disabled schedule recomputes nextRunAt from its own
 * definition, so a value left over from before it was disabled never makes the
 * local poller treat it as already due.
 */
test.describe('TC-SCHED-011: enabling a schedule recomputes nextRunAt', () => {
  test('PUT { id, isEnabled: true } moves nextRunAt to one interval after the enable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null

    try {
      scheduleId = await createScheduleJob(request, token, { scheduleValue: '1h', isEnabled: true })
      const created = await readRunTimes(request, token, scheduleId)

      const disableResponse = await apiRequest(request, 'PUT', SCHEDULER_JOBS_PATH, {
        token,
        data: { id: scheduleId, isEnabled: false },
      })
      expect(disableResponse.status()).toBe(200)

      await new Promise((resolve) => setTimeout(resolve, 2_000))

      const enableResponse = await apiRequest(request, 'PUT', SCHEDULER_JOBS_PATH, {
        token,
        data: { id: scheduleId, isEnabled: true },
      })
      expect(enableResponse.status()).toBe(200)

      const enabled = await readRunTimes(request, token, scheduleId)
      expect(enabled.nextRunAt).toBeGreaterThan(created.nextRunAt)
      expect(Math.abs(enabled.nextRunAt - (enabled.updatedAt + ONE_HOUR_MS))).toBeLessThan(1_000)
    } finally {
      await deleteScheduleJob(request, token, scheduleId)
    }
  })
})
