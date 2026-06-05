import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { rawApiRequest, uniqueToggleIdentifier } from './featureToggleTestHelpers'

test.describe('TC-FT-007: Check endpoints with missing/invalid toggles and authorization', () => {
  test('returns typed values and stable error statuses from check endpoints', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const identifiers = {
      boolean: uniqueToggleIdentifier('qa_check_bool'),
      string: uniqueToggleIdentifier('qa_check_string'),
      number: uniqueToggleIdentifier('qa_check_number'),
      json: uniqueToggleIdentifier('qa_check_json'),
    }
    const createdToggleIds: string[] = []

    try {
      const unauthenticatedResponse = await rawApiRequest(request, 'GET', '/api/feature_toggles/check/boolean')
      expect(unauthenticatedResponse.status()).toBe(401)

      const missingIdentifierResponse = await apiRequest(request, 'GET', '/api/feature_toggles/check/boolean', {
        token: adminToken,
      })
      expect(missingIdentifierResponse.status()).toBe(400)

      const missingToggleResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(uniqueToggleIdentifier('qa_missing_check'))}`,
        { token: adminToken },
      )
      expect(missingToggleResponse.status()).toBe(404)

      createdToggleIds.push(await createFeatureToggleFixture(request, superadminToken, {
        identifier: identifiers.boolean,
        name: 'QA Check Boolean',
        type: 'boolean',
        defaultValue: true,
      }))
      createdToggleIds.push(await createFeatureToggleFixture(request, superadminToken, {
        identifier: identifiers.string,
        name: 'QA Check String',
        type: 'string',
        defaultValue: 'hello',
      }))
      createdToggleIds.push(await createFeatureToggleFixture(request, superadminToken, {
        identifier: identifiers.number,
        name: 'QA Check Number',
        type: 'number',
        defaultValue: 42,
      }))
      createdToggleIds.push(await createFeatureToggleFixture(request, superadminToken, {
        identifier: identifiers.json,
        name: 'QA Check Json',
        type: 'json',
        defaultValue: { enabled: true },
      }))

      const booleanResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifiers.boolean)}`,
        { token: adminToken },
      )
      expect(booleanResponse.status()).toBe(200)
      const booleanBody = await readJsonSafe<{
        ok?: boolean
        value?: boolean
        resolution?: { source?: string; valueType?: string; tenantId?: string; toggleId?: string }
      }>(booleanResponse)
      expect(booleanBody?.ok).toBe(true)
      expect(booleanBody?.value).toBe(true)
      expect(booleanBody?.resolution).toMatchObject({
        source: 'default',
        valueType: 'boolean',
        toggleId: createdToggleIds[0],
      })
      expect(typeof booleanBody?.resolution?.tenantId).toBe('string')

      const stringResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/string?identifier=${encodeURIComponent(identifiers.string)}`,
        { token: adminToken },
      )
      expect(stringResponse.status()).toBe(200)
      const stringBody = await readJsonSafe<{ value?: string; resolution?: { valueType?: string } }>(stringResponse)
      expect(stringBody?.value).toBe('hello')
      expect(stringBody?.resolution?.valueType).toBe('string')

      const numberResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/number?identifier=${encodeURIComponent(identifiers.number)}`,
        { token: adminToken },
      )
      expect(numberResponse.status()).toBe(200)
      const numberBody = await readJsonSafe<{ value?: number; resolution?: { valueType?: string } }>(numberResponse)
      expect(numberBody?.value).toBe(42)
      expect(numberBody?.resolution?.valueType).toBe('number')

      const jsonResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/json?identifier=${encodeURIComponent(identifiers.json)}`,
        { token: adminToken },
      )
      expect(jsonResponse.status()).toBe(200)
      const jsonBody = await readJsonSafe<{ value?: { enabled?: boolean }; resolution?: { valueType?: string } }>(
        jsonResponse,
      )
      expect(jsonBody?.value).toEqual({ enabled: true })
      expect(jsonBody?.resolution?.valueType).toBe('json')

      const mismatchResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifiers.string)}`,
        { token: adminToken },
      )
      expect(mismatchResponse.status()).toBe(400)
      const mismatchBody = await readJsonSafe<{ ok?: boolean; error?: { code?: string } }>(mismatchResponse)
      expect(mismatchBody?.ok).toBe(false)
      expect(mismatchBody?.error?.code).toBe('TYPE_MISMATCH')

      const superadminBypassResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifiers.boolean)}`,
        { token: superadminToken },
      )
      expect(superadminBypassResponse.status()).toBe(200)
      const superadminBypassBody = await readJsonSafe<{
        ok?: boolean
        value?: boolean
        resolution?: { source?: string; toggleId?: string; tenantId?: string }
      }>(superadminBypassResponse)
      expect(superadminBypassBody?.ok).toBe(true)
      expect(superadminBypassBody?.value).toBe(true)
      expect(superadminBypassBody?.resolution).toMatchObject({
        source: 'override',
        toggleId: 'superadmin',
        tenantId: 'superadmin',
      })
    } finally {
      for (const toggleId of createdToggleIds) {
        await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
      }
    }
  })
})
