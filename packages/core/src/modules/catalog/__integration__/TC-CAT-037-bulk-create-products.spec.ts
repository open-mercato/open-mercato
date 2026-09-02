import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 30_000
const QUEUE_NAME = 'catalog-product-bulk-create'

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = TEST_APP_ROOT ? path.resolve(TEST_APP_ROOT) : path.resolve(process.cwd(), 'apps/mercato')
const APP_QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')

if (!TEST_APP_ROOT) {
  // Mirror TC-CRM-068 / TC-CAT-036: keep the in-process queue helper pointed at the same
  // dir the Next.js server uses, or the local file-based queue defaults to cwd-relative
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
 * TC-CAT-037: Bulk create catalog products
 *
 * Verifies the async POST /api/catalog/products/bulk-create flow end-to-end:
 *   - Returns 202 + progressJobId
 *   - The progress job transitions to `completed` via the queue worker
 *   - Valid rows are created and reachable through the standard list endpoint
 *   - A row whose SKU collides with an earlier row in the same batch is
 *     rejected by the worker's pre-validation without failing the whole batch
 *   - Schema validation rejects invalid payloads (empty items, missing title)
 */
test.describe('TC-CAT-037: Bulk create products', () => {
  test('creates products via the async queue worker and reports a batch-collision failure', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request)
    const stamp = Date.now()
    const duplicateSku = `TC-CAT-037-DUP-${stamp}`

    const createdIds: string[] = []

    try {
      const enqueueResponse = await apiRequest(request, 'POST', '/api/catalog/products/bulk-create', {
        token,
        data: {
          items: [
            { title: `TC-CAT-037 Alpha ${stamp}`, sku: duplicateSku },
            { title: `TC-CAT-037 Beta ${stamp}`, sku: `TC-CAT-037-B-${stamp}` },
            // Collides with the first row's SKU within the same batch — the worker's
            // pre-validation must fail this row without ever calling the command.
            { title: `TC-CAT-037 Gamma ${stamp}`, sku: duplicateSku },
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
        failedItems?: Array<{ index: number; title?: string; message: string }>
      } | undefined
      expect(summary?.createdCount).toBe(2)
      expect(summary?.failedCount).toBe(1)
      expect(summary?.failedItems?.[0]?.index).toBe(2)
      expect(summary?.failedItems?.[0]?.message).toContain('SKU already exists')
      createdIds.push(...(summary?.createdIds ?? []))
      expect(createdIds).toHaveLength(2)

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?search=${encodeURIComponent('TC-CAT-037')}&withDeleted=false`,
        { token },
      )
      const listBody = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      const listedIds = new Set((listBody.items ?? []).map((row) => row.id as string))
      for (const id of createdIds) {
        expect(listedIds.has(id), `Created product ${id} must appear in the list endpoint`).toBe(true)
      }
    } finally {
      for (const id of createdIds) {
        await deleteCatalogProductIfExists(request, token, id)
      }
    }
  })

  test('rejects invalid payloads with 400', async ({ request }) => {
    const token = await getAuthToken(request)

    const emptyResponse = await apiRequest(request, 'POST', '/api/catalog/products/bulk-create', {
      token,
      data: { items: [] },
    })
    expect(emptyResponse.status(), 'Empty items array must be rejected').toBe(400)

    const missingTitleResponse = await apiRequest(request, 'POST', '/api/catalog/products/bulk-create', {
      token,
      data: { items: [{ sku: 'NO-TITLE-ROW' }] },
    })
    expect(missingTitleResponse.status(), 'A row missing the required title field must be rejected').toBe(400)
  })
})
