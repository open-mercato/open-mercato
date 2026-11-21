import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'

const OVERRIDES_PATH = '/api/feature_toggles/overrides'

async function putOverride(request: APIRequestContext, token: string, data: Buffer | Record<string, unknown>) {
  return apiRequest(request, 'PUT', OVERRIDES_PATH, { token, data })
}

test.describe('TC-FT-014: Override PUT rejects a body that is not valid JSON with 400', () => {
  test('malformed and empty bodies return 400 Invalid payload and a valid change still succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier: `qa_override_malformed_json_${randomUUID().replace(/-/g, '')}`,
        name: 'QA Override Malformed JSON',
        type: 'boolean',
        defaultValue: true,
      })

      const malformedResponse = await putOverride(request, adminToken, Buffer.from('{not-valid-json'))
      expect(malformedResponse.status()).toBe(400)
      const malformedBody = await readJsonSafe<{ error?: string }>(malformedResponse)
      expect(malformedBody?.error).toBe('Invalid payload')

      const emptyResponse = await putOverride(request, adminToken, Buffer.alloc(0))
      expect(emptyResponse.status()).toBe(400)
      const emptyBody = await readJsonSafe<{ error?: string }>(emptyResponse)
      expect(emptyBody?.error).toBe('Invalid payload')

      const validResponse = await putOverride(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: false,
      })
      expect(validResponse.status()).toBe(200)
    } finally {
      if (toggleId) {
        await putOverride(request, adminToken, { toggleId, isOverride: false }).catch(() => undefined)
      }
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })
})
