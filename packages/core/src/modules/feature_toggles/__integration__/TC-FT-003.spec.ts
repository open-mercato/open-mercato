import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/featureTogglesFixtures'

test.describe('TC-FT-003: Typed feature toggle check APIs', () => {
  test('should return string, number, and json toggle values through typed check endpoints', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const createdToggleIds: string[] = []
    const identifiers = {
      string: `qa_string_${Date.now()}`,
      number: `qa_number_${Date.now()}`,
      json: `qa_json_${Date.now()}`,
    }

    try {
      createdToggleIds.push(await createFeatureToggleFixture(request, superadminToken, {
        identifier: identifiers.string,
        name: 'QA String Toggle',
        type: 'string',
        defaultValue: 'hello-world',
      }))
      createdToggleIds.push(await createFeatureToggleFixture(request, superadminToken, {
        identifier: identifiers.number,
        name: 'QA Number Toggle',
        type: 'number',
        defaultValue: 42,
      }))
      createdToggleIds.push(await createFeatureToggleFixture(request, superadminToken, {
        identifier: identifiers.json,
        name: 'QA Json Toggle',
        type: 'json',
        defaultValue: { enabled: true, channels: ['web', 'api'] },
      }))

      const stringResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/string?identifier=${encodeURIComponent(identifiers.string)}`,
        { token: adminToken },
      )
      const stringBody = await readJsonSafe<{
        ok?: boolean
        value?: string
        resolution?: { source?: string; valueType?: string }
      }>(stringResponse)
      expect(stringResponse.status()).toBe(200)
      expect(stringBody?.ok).toBe(true)
      expect(stringBody?.value).toBe('hello-world')
      expect(stringBody?.resolution?.valueType).toBe('string')
      expect(stringBody?.resolution?.source).toBe('default')

      const numberResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/number?identifier=${encodeURIComponent(identifiers.number)}`,
        { token: adminToken },
      )
      const numberBody = await readJsonSafe<{
        ok?: boolean
        value?: number
        resolution?: { valueType?: string }
      }>(numberResponse)
      expect(numberResponse.status()).toBe(200)
      expect(numberBody?.ok).toBe(true)
      expect(numberBody?.value).toBe(42)
      expect(numberBody?.resolution?.valueType).toBe('number')

      const jsonResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/json?identifier=${encodeURIComponent(identifiers.json)}`,
        { token: adminToken },
      )
      const jsonBody = await readJsonSafe<{
        ok?: boolean
        value?: { enabled?: boolean; channels?: string[] }
        resolution?: { valueType?: string }
      }>(jsonResponse)
      expect(jsonResponse.status()).toBe(200)
      expect(jsonBody?.ok).toBe(true)
      expect(jsonBody?.value).toEqual({ enabled: true, channels: ['web', 'api'] })
      expect(jsonBody?.resolution?.valueType).toBe('json')

      const missingIdentifierResponse = await apiRequest(request, 'GET', '/api/feature_toggles/check/string', {
        token: adminToken,
      })
      expect(missingIdentifierResponse.status()).toBe(400)
    } finally {
      for (const toggleId of createdToggleIds) {
        await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
      }
    }
  })
})
