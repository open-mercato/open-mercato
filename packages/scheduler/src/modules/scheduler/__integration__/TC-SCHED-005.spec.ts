import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  SCHEDULER_TRIGGER_PATH,
  createScheduleJob,
  deleteScheduleJob,
  uniqueScheduleName,
} from './helpers/scheduler'

const isAsyncQueueStrategy = (process.env.QUEUE_STRATEGY || 'local') === 'async'

/**
 * TC-SCHED-005: POST /api/scheduler/trigger manually enqueues a schedule for
 * execution. Manual triggers require the async (BullMQ) queue strategy, so the
 * assertion branches on QUEUE_STRATEGY exactly like TC-SCHED-001: async returns
 * 200 + jobId, local returns 400 with an "async required" message.
 */
test.describe('TC-SCHED-005: POST /api/scheduler/trigger manual execution', () => {
  test('enqueues an execution job (async) or rejects with async-required (local)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null

    try {
      scheduleId = await createScheduleJob(request, token, {
        name: uniqueScheduleName('Trigger-Test'),
        scheduleType: 'interval',
        scheduleValue: '1h',
      })

      const response = await apiRequest(request, 'POST', SCHEDULER_TRIGGER_PATH, {
        token,
        data: { id: scheduleId },
      })

      if (isAsyncQueueStrategy) {
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ ok?: boolean; jobId?: string; message?: string }>(response)
        expect(body?.ok).toBe(true)
        expect(typeof body?.jobId === 'string' && (body?.jobId?.length ?? 0) > 0).toBe(true)
        expect(body?.message ?? '').toMatch(/queued|triggered/i)
      } else {
        expect(response.status()).toBe(400)
        const body = await readJsonSafe<{ error?: string; message?: string }>(response)
        expect(`${body?.error ?? ''} ${body?.message ?? ''}`).toMatch(/async/i)
      }
    } finally {
      await deleteScheduleJob(request, token, scheduleId)
    }
  })
})
