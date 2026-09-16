import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

test.describe('TC-DS-012: Data sync adapter default batch size', () => {
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
        // Clamped to the same bounds `runSyncSchema` accepts, so a declared
        // value can never be one the run API would reject.
        expect(declared as number).toBeGreaterThanOrEqual(1)
        expect(declared as number).toBeLessThanOrEqual(1000)
      }
    }
  })
})
