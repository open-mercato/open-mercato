import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

type SearchSettingsResponse = {
  settings?: {
    strategies?: Array<{ id?: unknown; available?: unknown }>
  }
}

type ReindexResponse = {
  ok?: unknown
  result?: { recordsIndexed?: unknown; jobsEnqueued?: unknown }
}

type ProgressJobRow = {
  id: string
  status: string
  processedCount: number
  totalCount: number | null
}

type ProgressJobListResponse = {
  items?: ProgressJobRow[]
}

const REINDEX_JOB_TYPE = 'search.reindex.fulltext'
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled']
const DRAIN_TIMEOUT_MS = 180_000

async function readJson<T>(response: APIResponse): Promise<T> {
  return ((await readJsonSafe<T>(response)) ?? {}) as T
}

async function listReindexJobs(request: APIRequestContext, token: string): Promise<ProgressJobRow[]> {
  const params = new URLSearchParams({
    jobType: REINDEX_JOB_TYPE,
    status: 'pending,running,completed,failed,cancelled',
    sortField: 'createdAt',
    sortDir: 'desc',
    pageSize: '20',
  })
  const response = await apiRequest(request, 'GET', `/api/progress/jobs?${params.toString()}`, { token })
  if (!response.ok()) return []
  const body = await readJson<ProgressJobListResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

async function readReindexJob(request: APIRequestContext, token: string, jobId: string): Promise<ProgressJobRow | null> {
  return (await listReindexJobs(request, token)).find((job) => job.id === jobId) ?? null
}

async function waitForTerminal(request: APIRequestContext, token: string, jobId: string): Promise<ProgressJobRow | null> {
  await expect
    .poll(async () => (await readReindexJob(request, token, jobId))?.status ?? 'missing', { timeout: DRAIN_TIMEOUT_MS })
    .toMatch(new RegExp(`^(${TERMINAL_STATUSES.join('|')})$`))
  return readReindexJob(request, token, jobId)
}

/**
 * TC-SEARCH-017: a queued full fulltext reindex keeps its lock and progress until every batch drains.
 *
 * Queue workers start processing batches while the request is still enqueueing the rest. The run's
 * progress job must already exist by then, so early batches are counted and do not release the lock.
 * The run must finish as `completed` with every enqueued record counted, and while it is still
 * running a second reindex must be refused with 409 instead of taking the run over.
 * Skips when the environment has no fulltext (Meilisearch) backend.
 */
test.describe('TC-SEARCH-017: queued full fulltext reindex keeps ownership until batches drain', () => {
  test('counts every batch, completes the progress job and refuses a concurrent reindex', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let companyId: string | null = null
    const companyName = `QATCSEARCH017${Date.now()}`

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token

      const settingsResponse = await apiRequest(request, 'GET', '/api/search/settings', { token: authToken })
      expect(settingsResponse.ok()).toBeTruthy()
      const settings = await readJson<SearchSettingsResponse>(settingsResponse)
      const strategies = Array.isArray(settings.settings?.strategies) ? settings.settings.strategies : []
      if (!strategies.some((strategy) => strategy.id === 'fulltext' && strategy.available === true)) {
        test.skip(true, 'Fulltext strategy is not available in this environment')
        return
      }

      await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token: authToken }).catch(() => undefined)
      companyId = await createCompanyFixture(request, authToken, companyName)
      const knownJobIds = new Set((await listReindexJobs(request, authToken)).map((job) => job.id))

      const reindex = await apiRequest(request, 'POST', '/api/search/reindex', {
        token: authToken,
        data: { action: 'reindex', useQueue: true },
      })
      expect(reindex.status(), 'queued full reindex must be accepted').toBe(200)
      const reindexBody = await readJson<ReindexResponse>(reindex)
      expect(reindexBody.ok).toBe(true)
      const recordsIndexed = Number(reindexBody.result?.recordsIndexed ?? 0)
      expect(recordsIndexed, 'the reindex must enqueue at least the fixture company').toBeGreaterThan(0)
      expect(Number(reindexBody.result?.jobsEnqueued ?? 0)).toBeGreaterThan(0)

      const runJobs = (await listReindexJobs(request, authToken)).filter((job) => !knownJobIds.has(job.id))
      expect(runJobs, 'the run must have exactly one new progress job').toHaveLength(1)
      const runJobId = runJobs[0].id

      const retry = await apiRequest(request, 'POST', '/api/search/reindex', {
        token: authToken,
        data: { action: 'reindex', useQueue: true },
      })
      let retryJobId: string | null = null
      if (retry.status() !== 409) {
        expect(retry.status()).toBe(200)
        const runJobAtRetry = await readReindexJob(request, authToken, runJobId)
        expect(
          runJobAtRetry?.status,
          'a second reindex may only be accepted after the first run completed',
        ).toBe('completed')
        retryJobId = (await listReindexJobs(request, authToken))
          .find((job) => job.id !== runJobId && !knownJobIds.has(job.id))?.id ?? null
      }

      const finished = await waitForTerminal(request, authToken, runJobId)
      expect(finished?.status, 'the queued run must complete instead of staying running').toBe('completed')
      expect(finished?.totalCount).toBe(recordsIndexed)
      expect(finished?.processedCount, 'every enqueued record must be counted').toBe(recordsIndexed)

      if (retryJobId) await waitForTerminal(request, authToken, retryJobId)
    } finally {
      if (token) {
        await apiRequest(request, 'POST', '/api/search/reindex/cancel', { token }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
