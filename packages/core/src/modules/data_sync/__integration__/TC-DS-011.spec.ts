import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

test.describe('TC-DS-011: Data sync start control applicability', () => {
  test('options expose a well-formed startControls map for every data sync integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/data_sync/options', { token })
    expect(response.status()).toBe(200)
    const body = await readJson(response)
    const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []

    // The contract is provider-agnostic: every integration advertises an object
    // whose keys are its own entity types and whose values state, per control,
    // whether the dashboard should offer it. An adapter that declares nothing
    // ships `{}` — the dashboard then renders every control, as it always has.
    for (const item of items) {
      const startControls = item.startControls
      expect(startControls).toBeTruthy()
      expect(Array.isArray(startControls)).toBe(false)
      expect(typeof startControls).toBe('object')

      const supportedEntities = Array.isArray(item.supportedEntities)
        ? (item.supportedEntities as unknown[]).filter((value): value is string => typeof value === 'string')
        : []

      for (const [entityType, applicability] of Object.entries(startControls as JsonRecord)) {
        expect(supportedEntities).toContain(entityType)
        const controls = applicability as JsonRecord
        expect(typeof controls.fullSync).toBe('boolean')
        expect(typeof controls.batchSize).toBe('boolean')
        // A fully applicable entity type is omitted, so a present entry always
        // restricts at least one control.
        expect(controls.fullSync === false || controls.batchSize === false).toBe(true)
      }
    }
  })
})
