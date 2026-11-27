import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const integrationMeta = { dependsOnModules: ['workflows'] }

/**
 * TC-WF-9217 (bulk replay): the failure-queue bulk replay keeps working when the
 * optional `progress` module is disabled (#9217).
 *
 * Normal path: POST /api/workflows/instances/bulk-replay answers 202 `{ ok: true,
 * progressJobId }`; with progress enabled the job is a real, trackable progress job
 * that settles as completed.
 * Absent path (progress disabled): the same request still answers 202 and the replay
 * runs untracked with `progressJobId: null` instead of a 500 AwilixResolutionError.
 *
 * The replayed id is a fresh uuid no instance owns: the worker re-reads every id under
 * the caller's scope and skips the unknown one, so no workflow fixture is needed and
 * nothing is left behind.
 */

type ReplayBody = { ok?: boolean; progressJobId?: string | null; message?: string }
type ProgressJobBody = {
  status?: string
  resultSummary?: { action?: string; affectedCount?: number; skippedCount?: number; failedCount?: number }
}

async function isProgressModuleEnabled(request: APIRequestContext): Promise<boolean> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const probe = await apiRequest(request, 'GET', '/api/progress/jobs?pageSize=1', { token: superadminToken })
  expect([200, 404], `progress probe answered ${probe.status()}`).toContain(probe.status())
  return probe.status() === 200
}

async function requestBulkReplay(request: APIRequestContext, token: string): Promise<ReplayBody | null> {
  const replay = await apiRequest(request, 'POST', '/api/workflows/instances/bulk-replay', {
    token,
    data: { action: 'retry', ids: [randomUUID()] },
  })
  const body = await readJsonSafe<ReplayBody>(replay)
  expect(
    replay.status(),
    `bulk replay is accepted asynchronously (got ${replay.status()}: ${JSON.stringify(body)})`,
  ).toBe(202)
  expect(body?.ok).toBe(true)
  expect(body).toHaveProperty('progressJobId')
  return body
}

test.describe('TC-WF-9217: bulk replay with and without the progress module', () => {
  test('bulk replay answers 202 and, with progress enabled, hands back a job that completes', async ({ request }) => {
    test.setTimeout(120_000)

    const progressEnabled = await isProgressModuleEnabled(request)
    const token = await getAuthToken(request, 'admin')
    const body = await requestBulkReplay(request, token)

    await drainIntegrationQueue('workflow-instance-bulk-replay')

    if (!progressEnabled) return
    const progressJobId = body?.progressJobId
    expect(typeof progressJobId, 'progress enabled: the caller is handed a progress job').toBe('string')
    await expect
      .poll(
        async () => {
          const job = await apiRequest(request, 'GET', `/api/progress/jobs/${progressJobId}`, { token })
          if (job.status() !== 200) return `http ${job.status()}`
          return (await readJsonSafe<ProgressJobBody>(job))?.status ?? 'unknown'
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe('completed')
    const job = await apiRequest(request, 'GET', `/api/progress/jobs/${progressJobId}`, { token })
    const jobBody = await readJsonSafe<ProgressJobBody>(job)
    expect(jobBody?.resultSummary?.action).toBe('retry')
    expect(jobBody?.resultSummary?.affectedCount, 'an id outside the caller scope is never acted on').toBe(0)
    expect(jobBody?.resultSummary?.skippedCount).toBe(1)
    expect(jobBody?.resultSummary?.failedCount).toBe(0)
  })

  test('without the progress module the replay runs untracked with a null progressJobId', async ({ request }) => {
    test.setTimeout(120_000)

    const progressEnabled = await isProgressModuleEnabled(request)
    test.skip(progressEnabled, 'Requires an app without the optional progress module')

    const token = await getAuthToken(request, 'admin')
    const body = await requestBulkReplay(request, token)
    expect(body?.progressJobId, 'progress disabled: no progress job is created').toBeNull()

    await drainIntegrationQueue('workflow-instance-bulk-replay')
  })
})
