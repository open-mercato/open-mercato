import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCatalogCategoryIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

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

async function waitForProgressJob(
  request: APIRequestContext,
  token: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  await drainIntegrationQueue(QUEUE_NAME, { appRoot: APP_ROOT })
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

  test('honors a cancellation and stops the batch before its last row', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request)
    const stamp = Date.now()
    const prefix = `TC-CAT-036 Cancelled ${stamp}`
    // The batch has to be long enough that the worker is still working it when the cancel
    // request lands. `ephemeral-integration` runs the app with AUTO_SPAWN_WORKERS defaulting
    // to true, so a queue worker picks the job up on its own within milliseconds of the
    // enqueue — a one-row batch finished before the DELETE arrived and the job reported
    // `completed`, which is correct behaviour for a job that is already over but made this
    // test race the worker (PR #5610, CI run 33684841152).
    const items = Array.from({ length: 80 }, (_, index) => ({ name: `${prefix} ${index}` }))

    const createdIds: string[] = []
    try {
      const enqueueResponse = await apiRequest(request, 'POST', '/api/catalog/categories/bulk-create', {
        token,
        data: { items },
      })
      expect(enqueueResponse.status()).toBe(202)
      const { progressJobId } = (await enqueueResponse.json()) as { progressJobId: string }

      const cancelResponse = await apiRequest(request, 'DELETE', `/api/progress/jobs/${progressJobId}`, { token })
      expect(cancelResponse.status(), 'A cancellable bulk-create job must accept a cancel request').toBe(200)

      const finalJob = await waitForProgressJob(request, token, progressJobId)
      expect(finalJob.status, `progress job final status: ${JSON.stringify(finalJob)}`).toBe('cancelled')

      // Cancellation is cooperative: the worker stops at its next checkpoint-boundary poll, so
      // strictly fewer than `items.length` categories exist. Counting through the list endpoint
      // rather than the job's partial summary keeps the assertion true for both interleavings —
      // a cancel that lands before the worker starts writes no summary at all.
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/categories?search=${encodeURIComponent(prefix)}&status=all&pageSize=100`,
        { token },
      )
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>>; total?: number }
      createdIds.push(...(listBody.items ?? []).map((row) => row.id as string))
      expect(
        listBody.total ?? createdIds.length,
        'A cancelled batch must stop before creating every row',
      ).toBeLessThan(items.length)
    } finally {
      for (const id of createdIds) {
        await deleteCatalogCategoryIfExists(request, token, id)
      }
    }
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
