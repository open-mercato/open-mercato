import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

/**
 * TC-DS-015: Data sync adapters advertise their declared default page size
 *
 * Covers the wire contract of `.ai/specs/2026-09-16-data-sync-adapter-default-batch-size.md`:
 * `GET /api/data_sync/options` ships a sparse `defaultBatchSizes` map per
 * integration — the map the dashboard reads to seed its Batch size field — and
 * every value must be one the run API itself accepts, so a declaration can never
 * produce a run request the API rejects. An adapter that declares nothing ships
 * `{}`; the dashboard then keeps core's 100, exactly as before the feature.
 *
 * The declared-value half of the contract (an adapter's number reaching the queued
 * run and the seeded field) is covered at the chokepoint in
 * `lib/__tests__/start-run.test.ts` and, for the shipped map, by
 * `api/__tests__/options.test.ts`; this spec pins the public shape the UI consumes.
 */
test.describe('TC-DS-015: Data sync adapter default batch size', () => {
  test('options expose a well-formed defaultBatchSizes map for every data sync integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/data_sync/options', { token })
    expect(response.status()).toBe(200)
    const body = await readJson(response)
    const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []

    // The contract is provider-agnostic: every integration advertises an object
    // whose keys are its own entity types and whose values are page sizes the
    // run API would itself accept. An adapter that declares nothing ships `{}`
    // — the dashboard then seeds core's default, as it always has.
    for (const item of items) {
      const defaultBatchSizes = item.defaultBatchSizes
      expect(defaultBatchSizes).toBeTruthy()
      expect(Array.isArray(defaultBatchSizes)).toBe(false)
      expect(typeof defaultBatchSizes).toBe('object')

      const supportedEntities = Array.isArray(item.supportedEntities)
        ? (item.supportedEntities as unknown[]).filter((value): value is string => typeof value === 'string')
        : []

      for (const [entityType, declared] of Object.entries(defaultBatchSizes as JsonRecord)) {
        expect(supportedEntities).toContain(entityType)
        expect(Number.isInteger(declared)).toBe(true)
        // Clamped to the same bounds the run API accepts, so a declared
        // value can never be one the run API would reject.
        expect(declared as number).toBeGreaterThanOrEqual(1)
        expect(declared as number).toBeLessThanOrEqual(1000)
      }
    }
  })
})
