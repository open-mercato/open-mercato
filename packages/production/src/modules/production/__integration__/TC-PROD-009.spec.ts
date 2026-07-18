import path from 'node:path'
import { expect, test } from '@playwright/test'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  apiRequest,
  getAuthToken,
  readJsonSafe,
  ensureProductionEnabledToggle,
  createPlanningParams,
  deletePlanningParamsIfExists,
  uniqueUuid,
} from './helpers/production'

type MrpRunResponse = { id?: string }
type MrpRunDetail = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  stats: { demandsProcessed?: number; suggestionsOpen?: number } | null
}
type MrpSuggestionRow = {
  id: string
  productId: string
  suggestionType: 'make' | 'buy' | 'reschedule' | 'cancel'
  status: 'open' | 'accepted' | 'dismissed' | 'superseded'
}
type SuggestionsResponse = { items: MrpSuggestionRow[]; total: number }

const MRP_RUN_QUEUE = 'production-mrp'
const OM_TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = OM_TEST_APP_ROOT ? path.resolve(OM_TEST_APP_ROOT) : path.resolve(process.cwd(), 'apps/mercato')

const POLL_INTERVAL_MS = 200
const POLL_TIMEOUT_MS = 30_000

/**
 * TC-PROD-009: MRP run + bulk accept/dismiss suggestions (task 5.4).
 *
 * Feasibility decision (documented per the task brief, mirrors TC-CRM-068/
 * 069's own reasoning): the production Playwright harness does not run a
 * separate queue-worker process, so a real `MrpRun` created via
 * `POST /api/production/mrp/runs` would stay `pending` forever without
 * manual intervention. Rather than adding a new test-only trigger endpoint
 * to production code (no such admin/test hook exists here, unlike the
 * scheduler module's own `POST /api/scheduler/trigger`), this spec reuses
 * the platform's existing `drainIntegrationQueue` helper
 * (`@open-mercato/core/helpers/integration/queue`, already used by
 * `TC-CRM-069`) to process the enqueued `production-mrp` job in-process. This
 * exercises the REAL worker code path (`lib/mrp/runJob.ts` via the
 * `workers/mrp-run.worker.ts` `metadata.queue` registration) — it is not a
 * mock — the only thing swapped is which process pulls the job off the
 * local file-based queue.
 *
 * Demand fixture: rather than depending on the (optional) `sales` module,
 * this seeds two `ProductPlanningParams` rows with `safetyStock` above the
 * product's free stock (no `StockItem` fixture -> `onHand=0`), which
 * synthesizes a `min_stock` MRP demand for each (`loaders.ts`
 * `computeMinStockDeficits`) with `procurement: 'buy'` (no BOM, so no
 * child-level explosion) — the simplest deterministic way to get real,
 * persisted `MrpSuggestion` rows for a run without any new production
 * surface area.
 *
 * Coverage: run creation + worker completion + suggestions list/filters +
 * bulk accept (this DoD's required "test integracyjny akceptacji masowej")
 * + bulk dismiss (second primary UI action, for parity). Fine-grained
 * per-suggestion-type/accept-creates-order semantics are already covered by
 * `commands/__tests__/mrp.test.ts` (unit level) — this spec's job is the
 * end-to-end wiring (API -> queue -> worker -> persisted suggestions ->
 * bulk API -> DataTable's underlying list/filter contract), not
 * re-deriving the command-level test matrix.
 */
async function waitForRunCompletion(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  runId: string,
): Promise<MrpRunDetail> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let last: MrpRunDetail | null = null
  while (Date.now() < deadline) {
    const response = await apiRequest(request, 'GET', `/api/production/mrp/runs?id=${runId}`, { token })
    if (response.ok()) {
      const body = await readJsonSafe<{ items?: MrpRunDetail[] }>(response)
      const run = (body?.items ?? [])[0] ?? null
      if (run) {
        last = run
        if (run.status === 'completed' || run.status === 'failed') return run
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`MRP run ${runId} did not finish within ${POLL_TIMEOUT_MS}ms (last status: ${JSON.stringify(last)})`)
}

test.describe('TC-PROD-009: MRP run + bulk accept/dismiss suggestions', () => {
  test('creates a run, drains the worker, lists/filters suggestions, and bulk accepts/dismisses them', async ({ request }) => {
    test.setTimeout(90_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    await ensureProductionEnabledToggle(request, superadminToken)

    const acceptProductIds = [uniqueUuid(), uniqueUuid()]
    const dismissProductIds = [uniqueUuid(), uniqueUuid()]
    const planningParamIds: string[] = []
    let runId: string | null = null

    try {
      for (const productId of [...acceptProductIds, ...dismissProductIds]) {
        planningParamIds.push(
          await createPlanningParams(request, adminToken, { productId, procurement: 'buy', safetyStock: 15 }),
        )
      }

      // --- Create the run ---
      const createResponse = await apiRequest(request, 'POST', '/api/production/mrp/runs', {
        token: adminToken,
        data: {},
      })
      expect(createResponse.status(), 'POST /api/production/mrp/runs should return 201').toBe(201)
      const createBody = await readJsonSafe<MrpRunResponse>(createResponse)
      expect(typeof createBody?.id === 'string', 'run creation response should include an id').toBe(true)
      runId = String(createBody!.id)

      // --- Drain the real worker in-process (see docstring: no separate worker process in this harness) ---
      await drainIntegrationQueue(MRP_RUN_QUEUE, { appRoot: APP_ROOT })

      // --- Poll until the worker finishes ---
      const finalRun = await waitForRunCompletion(request, adminToken, runId)
      expect(finalRun.status, `run final status: ${JSON.stringify(finalRun)}`).toBe('completed')
      expect(finalRun.stats?.demandsProcessed ?? 0).toBeGreaterThanOrEqual(4)
      expect(finalRun.stats?.suggestionsOpen ?? 0).toBeGreaterThanOrEqual(4)

      // --- List + filter: our 4 seeded buy suggestions are open by default ---
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/production/mrp/runs/${runId}/suggestions?status=open&suggestionType=buy&pageSize=100`,
        { token: adminToken },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<SuggestionsResponse>(listResponse)
      const allProductIds = new Set([...acceptProductIds, ...dismissProductIds])
      const ourSuggestions = (listBody?.items ?? []).filter((row) => allProductIds.has(row.productId))
      expect(ourSuggestions.length, `expected 4 seeded buy suggestions, got: ${JSON.stringify(ourSuggestions)}`).toBe(4)
      for (const row of ourSuggestions) {
        expect(row.suggestionType).toBe('buy')
        expect(row.status).toBe('open')
      }

      const acceptIds = ourSuggestions.filter((row) => acceptProductIds.includes(row.productId)).map((row) => row.id)
      const dismissIds = ourSuggestions.filter((row) => dismissProductIds.includes(row.productId)).map((row) => row.id)
      expect(acceptIds.length).toBe(2)
      expect(dismissIds.length).toBe(2)

      // --- Bulk accept (DoD: "Test integracyjny akceptacji masowej") ---
      const acceptResponse = await apiRequest(request, 'POST', '/api/production/mrp/suggestions/accept', {
        token: adminToken,
        data: { ids: acceptIds },
      })
      expect(acceptResponse.status()).toBe(200)
      const acceptBody = await readJsonSafe<{ acceptedIds: string[]; createdOrderIds: string[]; skippedIds: string[] }>(
        acceptResponse,
      )
      expect(acceptBody?.acceptedIds?.sort()).toEqual([...acceptIds].sort())
      // `buy` suggestions never create a draft production order (spec decision d).
      expect(acceptBody?.createdOrderIds ?? []).toEqual([])
      expect(acceptBody?.skippedIds ?? []).toEqual([])

      // --- Re-submitting an already-accepted id is idempotent (skipped, not an error) ---
      const reAcceptResponse = await apiRequest(request, 'POST', '/api/production/mrp/suggestions/accept', {
        token: adminToken,
        data: { ids: acceptIds },
      })
      expect(reAcceptResponse.status()).toBe(200)
      const reAcceptBody = await readJsonSafe<{ acceptedIds: string[]; skippedIds: string[] }>(reAcceptResponse)
      expect(reAcceptBody?.acceptedIds ?? []).toEqual([])
      expect(reAcceptBody?.skippedIds?.sort()).toEqual([...acceptIds].sort())

      // --- Bulk dismiss ---
      const dismissResponse = await apiRequest(request, 'POST', '/api/production/mrp/suggestions/dismiss', {
        token: adminToken,
        data: { ids: dismissIds },
      })
      expect(dismissResponse.status()).toBe(200)
      const dismissBody = await readJsonSafe<{ dismissedIds: string[]; skippedIds: string[] }>(dismissResponse)
      expect(dismissBody?.dismissedIds?.sort()).toEqual([...dismissIds].sort())
      expect(dismissBody?.skippedIds ?? []).toEqual([])

      // --- List/filter reflects both bulk actions: nothing of ours stays "open" ---
      const openAfterResponse = await apiRequest(
        request,
        'GET',
        `/api/production/mrp/runs/${runId}/suggestions?status=open&pageSize=100`,
        { token: adminToken },
      )
      const openAfterBody = await readJsonSafe<SuggestionsResponse>(openAfterResponse)
      const stillOpenOfOurs = (openAfterBody?.items ?? []).filter((row) => allProductIds.has(row.productId))
      expect(stillOpenOfOurs).toEqual([])

      const acceptedResponse = await apiRequest(
        request,
        'GET',
        `/api/production/mrp/runs/${runId}/suggestions?status=accepted&pageSize=100`,
        { token: adminToken },
      )
      const acceptedBody = await readJsonSafe<SuggestionsResponse>(acceptedResponse)
      expect((acceptedBody?.items ?? []).map((row) => row.id).sort()).toEqual([...acceptIds].sort())

      const dismissedResponse = await apiRequest(
        request,
        'GET',
        `/api/production/mrp/runs/${runId}/suggestions?status=dismissed&pageSize=100`,
        { token: adminToken },
      )
      const dismissedBody = await readJsonSafe<SuggestionsResponse>(dismissedResponse)
      expect((dismissedBody?.items ?? []).map((row) => row.id).sort()).toEqual([...dismissIds].sort())
    } finally {
      for (const id of planningParamIds) {
        await deletePlanningParamsIfExists(request, adminToken, id)
      }
    }
  })

  test('rejects an empty ids array with 400 (bulk accept/dismiss input validation)', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const acceptResponse = await apiRequest(request, 'POST', '/api/production/mrp/suggestions/accept', {
      token: adminToken,
      data: { ids: [] },
    })
    expect(acceptResponse.status()).toBe(400)

    const dismissResponse = await apiRequest(request, 'POST', '/api/production/mrp/suggestions/dismiss', {
      token: adminToken,
      data: { ids: [] },
    })
    expect(dismissResponse.status()).toBe(400)
  })
})
