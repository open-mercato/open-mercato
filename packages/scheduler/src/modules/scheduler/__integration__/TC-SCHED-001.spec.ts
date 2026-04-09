import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

const isAsyncQueueStrategy = (process.env.QUEUE_STRATEGY || 'local') === 'async'

type CreateScheduleResponse = { id?: string }
type SchedulerListResponse = { items?: Array<{ id?: string }> }
type SchedulerErrorResponse = { error?: string; message?: string; available?: boolean; items?: unknown[] }

async function createSchedule(request: import('@playwright/test').APIRequestContext, token: string) {
  const response = await apiRequest(request, 'POST', '/api/scheduler/jobs', {
    token,
    data: {
      name: `Integration Scheduler ${Date.now()}`,
      description: 'Runtime Redis URL integration probe',
      scopeType: 'organization',
      scheduleType: 'interval',
      scheduleValue: '15m',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'scheduler-execution',
      targetPayload: { source: 'integration-test' },
      isEnabled: true,
      sourceType: 'user',
    },
  })

  expect(response.status()).toBe(201)
  const body = (await response.json()) as CreateScheduleResponse
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/i)
  return String(body.id)
}

test.describe('TC-SCHED-001: Scheduler runtime queue APIs', () => {
  test('lists created schedules and exposes execution-history endpoint semantics', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null

    try {
      scheduleId = await createSchedule(request, token)

      const listResponse = await apiRequest(request, 'GET', `/api/scheduler/jobs?id=${scheduleId}`, { token })
      expect(listResponse.status()).toBe(200)
      const listBody = (await listResponse.json()) as SchedulerListResponse
      const ids = (listBody.items ?? []).map((item) => item.id)
      expect(ids).toContain(scheduleId)

      const executionsResponse = await apiRequest(
        request,
        'GET',
        `/api/scheduler/jobs/${scheduleId}/executions?pageSize=5`,
        { token },
      )

      if (isAsyncQueueStrategy) {
        expect(executionsResponse.status()).toBe(200)
        const executionsBody = (await executionsResponse.json()) as { items?: unknown[]; total?: number; pageSize?: number }
        expect(Array.isArray(executionsBody.items)).toBe(true)
        expect(typeof executionsBody.total).toBe('number')
        expect(executionsBody.pageSize).toBe(5)
      } else {
        expect(executionsResponse.status()).toBe(400)
        const executionsBody = (await executionsResponse.json()) as SchedulerErrorResponse
        expect(executionsBody.error ?? '').toMatch(/QUEUE_STRATEGY=async|Execution history requires/i)
        expect(Array.isArray(executionsBody.items)).toBe(true)
      }
    } finally {
      if (scheduleId) {
        await apiRequest(request, 'DELETE', '/api/scheduler/jobs', {
          token,
          data: { id: scheduleId },
        }).catch(() => null)
      }
    }
  })

  test('validates queue names and async-only queue job access', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const invalidQueueResponse = await apiRequest(
      request,
      'GET',
      '/api/scheduler/queue-jobs/non-existent?queue=not-a-registered-queue',
      { token },
    )
    expect(invalidQueueResponse.status()).toBe(400)
    const invalidQueueBody = (await invalidQueueResponse.json()) as SchedulerErrorResponse
    expect(invalidQueueBody.error ?? '').toMatch(/Invalid queue name/i)

    const validQueueResponse = await apiRequest(
      request,
      'GET',
      '/api/scheduler/queue-jobs/non-existent?queue=scheduler-execution',
      { token },
    )

    if (isAsyncQueueStrategy) {
      expect(validQueueResponse.status()).toBe(404)
      const validQueueBody = (await validQueueResponse.json()) as SchedulerErrorResponse
      expect(validQueueBody.error ?? '').toMatch(/Job not found/i)
    } else {
      expect(validQueueResponse.status()).toBe(400)
      const validQueueBody = (await validQueueResponse.json()) as SchedulerErrorResponse
      expect(validQueueBody.error ?? '').toMatch(/QUEUE_STRATEGY=async|BullMQ job logs are only available/i)
      expect(validQueueBody.available).toBe(false)
    }
  })
})
