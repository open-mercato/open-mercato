import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCatalogCategoryIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createQueue } from '@open-mercato/queue'

const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 30_000
const QUEUE_NAME = 'catalog-category-bulk-create'

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = TEST_APP_ROOT ? path.resolve(TEST_APP_ROOT) : path.resolve(process.cwd(), 'apps/mercato')
const APP_QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')

if (!TEST_APP_ROOT) {
  // Mirror TC-CRM-068: keep the in-process queue helper pointed at the same dir the
  // Next.js server uses, or the local file-based queue defaults to cwd-relative
  // `.mercato/queue/` and the worker handler never finds the queued jobs.
  process.env.QUEUE_BASE_DIR = APP_QUEUE_BASE_DIR
}

/**
 * Drains the local file-based queue in-process by running the registered worker handler
 * against every available job. CI's integration test harness runs no separate worker
 * process — the Next.js server only enqueues — so without this the bulk-create job stays
 * `pending` forever and the progress-poll loop below times out. Copied (and adapted) from
 * TC-CRM-068's `drainQueue` helper.
 */
async function drainQueue(queueName: string): Promise<number> {
  const data = await bootstrapFromAppRoot(APP_ROOT)
  const worker = data.modules.flatMap((module) => module.workers ?? []).find((entry) => entry.queue === queueName)
  if (!worker) return 0

  const container = await createRequestContainer()
  const queue = createQueue(queueName, 'local', { baseDir: APP_QUEUE_BASE_DIR, concurrency: 1 })
  const resolve = <T = unknown>(name: string): T => container.resolve(name) as T

  try {
    let processedJobs = 0
    while (true) {
      const result = await queue.process(
        async (job, ctx) => {
          await Promise.resolve(worker.handler(job, { ...ctx, resolve }))
        },
        { limit: 100 },
      )
      const handled = result.processed + result.failed
      processedJobs += handled
      if (handled === 0) return processedJobs
    }
  } finally {
    await queue.close()
  }
}

async function waitForProgressJob(
  request: APIRequestContext,
  token: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  await drainQueue(QUEUE_NAME)
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let last: Record<string, unknown> | null = null
  while (Date.now() < deadline) {
    const response = await apiRequest(request, 'GET', `/api/progress/jobs/${jobId}`, { token })
    if (response.ok()) {
      const body = (await response.json()) as Record<string, unknown>
      last = body
      const status = body.status as string | undefined
      if (status === 'completed' || status === 'failed' || status === 'cancelled') return body
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Progress job ${jobId} did not finish within ${POLL_TIMEOUT_MS}ms (last status: ${JSON.stringify(last)})`)
}

/**
 * TC-CAT-036: Bulk create catalog categories
 *
 * Verifies the async POST /api/catalog/categories/bulk-create flow end-to-end:
 *   - Returns 202 + progressJobId
 *   - The progress job transitions to `completed` via the queue worker
 *   - Valid rows are created and reachable through the standard list endpoint
 *   - A row whose slug collides with an earlier row in the same batch is
 *     rejected by the worker's pre-validation without failing the whole batch
 *   - Schema validation rejects invalid payloads (empty items, missing name)
 */
test.describe('TC-CAT-036: Bulk create categories', () => {
  test('creates categories via the async queue worker and reports a batch-collision failure', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request)
    const stamp = Date.now()
    const names = [`TC-CAT-036 Alpha ${stamp}`, `TC-CAT-036 Beta ${stamp}`]
    const duplicateSlug = `tc-cat-036-dup-${stamp}`

    const createdIds: string[] = []

    try {
      const enqueueResponse = await apiRequest(request, 'POST', '/api/catalog/categories/bulk-create', {
        token,
        data: {
          items: [
            { name: names[0], slug: duplicateSlug },
            { name: names[1] },
            // Collides with the first row's slug within the same batch — the worker's
            // pre-validation must fail this row without ever calling the command.
            { name: `TC-CAT-036 Gamma ${stamp}`, slug: duplicateSlug },
          ],
        },
      })
      expect(enqueueResponse.status(), `POST /bulk-create status: ${enqueueResponse.status()}`).toBe(202)
      const enqueueBody = (await enqueueResponse.json()) as { ok?: boolean; progressJobId?: string }
      expect(enqueueBody.ok).toBe(true)
      expect(typeof enqueueBody.progressJobId, 'response must carry a progressJobId').toBe('string')

      const finalJob = await waitForProgressJob(request, token, enqueueBody.progressJobId!)
      expect(finalJob.status, `progress job final status: ${JSON.stringify(finalJob)}`).toBe('completed')

      const summary = finalJob.resultSummary as {
        createdCount?: number
        failedCount?: number
        createdIds?: string[]
        failedItems?: Array<{ index: number; name?: string; message: string }>
      } | undefined
      expect(summary?.createdCount).toBe(2)
      expect(summary?.failedCount).toBe(1)
      expect(summary?.failedItems?.[0]?.index).toBe(2)
      expect(summary?.failedItems?.[0]?.message).toContain('slug already exists')
      createdIds.push(...(summary?.createdIds ?? []))
      expect(createdIds).toHaveLength(2)

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/categories?search=${encodeURIComponent(`TC-CAT-036`)}&status=all`,
        { token },
      )
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      const listedIds = new Set((listBody.items ?? []).map((row) => row.id as string))
      for (const id of createdIds) {
        expect(listedIds.has(id), `Created category ${id} must appear in the list endpoint`).toBe(true)
      }
    } finally {
      for (const id of createdIds) {
        await deleteCatalogCategoryIfExists(request, token, id)
      }
    }
  })

  test('honors a cancellation requested before the worker picks the batch up', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request)
    const stamp = Date.now()
    const name = `TC-CAT-036 Cancelled ${stamp}`

    const enqueueResponse = await apiRequest(request, 'POST', '/api/catalog/categories/bulk-create', {
      token,
      data: { items: [{ name }] },
    })
    expect(enqueueResponse.status()).toBe(202)
    const { progressJobId } = (await enqueueResponse.json()) as { progressJobId: string }

    const cancelResponse = await apiRequest(request, 'DELETE', `/api/progress/jobs/${progressJobId}`, { token })
    expect(cancelResponse.status(), 'A cancellable bulk-create job must accept a cancel request').toBe(200)

    const finalJob = await waitForProgressJob(request, token, progressJobId)
    expect(finalJob.status, `progress job final status: ${JSON.stringify(finalJob)}`).toBe('cancelled')

    // The worker observed the cancel on its first checkpoint-boundary poll, before executing
    // any row, so nothing was created and the job is not silently left `running`.
    const listResponse = await apiRequest(
      request,
      'GET',
      `/api/catalog/categories?search=${encodeURIComponent(name)}&status=all`,
      { token },
    )
    const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
    expect(listBody.items ?? [], 'A cancelled batch must not create any category').toHaveLength(0)
  })

  test('rejects invalid payloads with 400 and reports the failing row path', async ({ request }) => {
    const token = await getAuthToken(request)

    const emptyResponse = await apiRequest(request, 'POST', '/api/catalog/categories/bulk-create', {
      token,
      data: { items: [] },
    })
    expect(emptyResponse.status(), 'Empty items array must be rejected').toBe(400)

    const missingNameResponse = await apiRequest(request, 'POST', '/api/catalog/categories/bulk-create', {
      token,
      data: { items: [{ name: 'ok' }, { slug: 'no-name-row' }] },
    })
    expect(missingNameResponse.status(), 'A row missing the required name field must be rejected').toBe(400)

    // A bare "Invalid payload" is unusable for a multi-thousand-row batch, so the route reports
    // the offending paths.
    const body = (await missingNameResponse.json()) as { errors?: Array<{ path: string; message: string }> }
    expect(body.errors?.some((issue) => issue.path === 'items.1.name'), `errors: ${JSON.stringify(body.errors)}`).toBe(true)
  })
})
