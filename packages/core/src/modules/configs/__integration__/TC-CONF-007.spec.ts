import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  QUEUE_STATUS_TEST_QUEUE,
  cleanupTestJobs,
  openTestQueue,
  uniqueMarker,
} from './helpers/queueStatusFixtures'

type Snapshot = {
  generatedAt: string
  canInspectPayloads: boolean
  queues: Array<{
    queue: string
    strategy: 'local' | 'async'
    counts: Record<string, number>
    error?: string
    failedJobs?: Array<Record<string, unknown>>
    inFlight?: Array<Record<string, unknown>>
    agedWaiting?: Array<{ id: string; type?: string; state: string }>
  }>
}

/**
 * TC-CONF-007: Queue status snapshot (Tier 1) — GET /api/configs/queues-status
 * Source: issue #3105
 *
 * Covers the dispatcher feature gate, payload-freeness of the broadly granted response, the
 * payload-free job-type filter and the unknown-queue / invalid-query contracts. The job is created
 * through the real enqueue path of whichever strategy the harness runs (local or BullMQ).
 */
test.describe('TC-CONF-007: Queue status snapshot (Tier 1)', () => {
  test('requires configs.queues_status.view and never exposes a job payload', async ({ request }) => {
    const queue = openTestQueue()
    const secret = uniqueMarker('payload-secret')
    const jobType = uniqueMarker('qs-type')
    const tenantId = '00000000-0000-4000-8000-0000000000a1'
    try {
      await queue.enqueue({ tenantId, jobType, note: secret })

      const anonymous = await request.fetch('/api/configs/queues-status', { method: 'GET' })
      expect([401, 403], 'anonymous callers must be rejected').toContain(anonymous.status())

      const employeeToken = await getAuthToken(request, 'employee')
      const denied = await apiRequest(request, 'GET', '/api/configs/queues-status', { token: employeeToken })
      expect(denied.status(), 'a role without configs.queues_status.view is denied').toBe(403)

      const adminToken = await getAuthToken(request, 'admin')
      const response = await apiRequest(request, 'GET', `/api/configs/queues-status?queue=${QUEUE_STATUS_TEST_QUEUE}`, {
        token: adminToken,
      })
      expect(response.status()).toBe(200)
      const body = (await readJsonSafe<Snapshot>(response)) as Snapshot
      expect(body.canInspectPayloads, 'admin does not hold the Tier 2 feature').toBe(false)

      const entry = body.queues.find((candidate) => candidate.queue === QUEUE_STATUS_TEST_QUEUE)
      expect(entry, 'the registered queue is listed').toBeDefined()
      expect(entry?.error).toBeUndefined()
      expect(entry!.counts.waiting + (entry!.counts.delayed ?? 0)).toBeGreaterThanOrEqual(1)

      const serialized = JSON.stringify(body)
      expect(serialized, 'the payload must never be part of the Tier 1 response').not.toContain(secret)
      expect(serialized).not.toContain('"payload"')
      expect(serialized).not.toContain('"failedReason"')
    } finally {
      await cleanupTestJobs(queue, [tenantId])
    }
  })

  test('filters the bounded summaries by the payload-free job type', async ({ request }) => {
    const queue = openTestQueue()
    const matchingType = uniqueMarker('qs-match')
    const otherType = uniqueMarker('qs-other')
    const tenantId = '00000000-0000-4000-8000-0000000000a2'
    try {
      const matchingId = await queue.enqueue({ tenantId, jobType: matchingType })
      await queue.enqueue({ tenantId, jobType: otherType })

      const adminToken = await getAuthToken(request, 'admin')
      const response = await apiRequest(
        request,
        'GET',
        `/api/configs/queues-status?queue=${QUEUE_STATUS_TEST_QUEUE}&type=${encodeURIComponent(matchingType)}`,
        { token: adminToken },
      )
      expect(response.status()).toBe(200)
      const body = (await readJsonSafe<Snapshot>(response)) as Snapshot
      const entry = body.queues.find((candidate) => candidate.queue === QUEUE_STATUS_TEST_QUEUE)

      const queued = entry?.agedWaiting ?? []
      expect(queued.map((job) => job.id)).toContain(matchingId)
      expect(queued.every((job) => job.type === matchingType), 'only the requested type is listed').toBe(true)
      // A pending job is listed once, even on a strategy that cannot tell waiting from delayed.
      expect(new Set(queued.map((job) => job.id)).size).toBe(queued.length)
    } finally {
      await cleanupTestJobs(queue, [tenantId])
    }
  })

  test('answers an unknown queue with an empty snapshot and rejects malformed queries with 400', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    const unknown = await apiRequest(request, 'GET', '/api/configs/queues-status?queue=does-not-exist-qs', { token: adminToken })
    expect(unknown.status()).toBe(200)
    expect(((await readJsonSafe<Snapshot>(unknown)) as Snapshot).queues).toEqual([])

    const tooLong = await apiRequest(request, 'GET', `/api/configs/queues-status?type=${'x'.repeat(500)}`, { token: adminToken })
    expect(tooLong.status(), 'validation errors are a 400, never a 500').toBe(400)
  })
})
