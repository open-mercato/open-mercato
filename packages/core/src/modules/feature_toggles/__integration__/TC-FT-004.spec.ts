import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { uniqueToggleIdentifier } from './featureToggleTestHelpers'

test.describe('TC-FT-004: Global feature toggle validation and error handling', () => {
  test('rejects invalid payloads and persists valid create/update fields', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const validIdentifier = uniqueToggleIdentifier('qa_valid')
    const optionalIdentifier = uniqueToggleIdentifier('qa_optional')
    let validToggleId: string | null = null
    let optionalToggleId: string | null = null

    try {
      for (const invalidIdentifier of ['BadKey-123', '9invalid']) {
        const response = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
          token,
          data: {
            identifier: invalidIdentifier,
            name: 'Invalid Toggle',
            type: 'boolean',
            defaultValue: true,
          },
        })
        expect(response.status(), `identifier ${invalidIdentifier} should be rejected`).toBe(400)
      }

      validToggleId = await createFeatureToggleFixture(request, token, {
        identifier: validIdentifier,
        name: 'QA Valid Toggle',
        type: 'boolean',
        defaultValue: true,
      })

      const duplicateResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token,
        data: {
          identifier: validIdentifier,
          name: 'QA Duplicate Toggle',
          type: 'boolean',
          defaultValue: false,
        },
      })
      expect(duplicateResponse.status(), 'duplicate identifier should return 400').toBe(400)

      const missingNameResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token,
        data: {
          identifier: uniqueToggleIdentifier('qa_missing_name'),
          type: 'boolean',
          defaultValue: true,
        },
      })
      expect(missingNameResponse.status(), 'missing name should return 400').toBe(400)

      const missingTypeResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token,
        data: {
          identifier: uniqueToggleIdentifier('qa_missing_type'),
          name: 'QA Missing Type',
          defaultValue: true,
        },
      })
      expect(missingTypeResponse.status(), 'missing type should return 400').toBe(400)

      const invalidTypeResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token,
        data: {
          identifier: uniqueToggleIdentifier('qa_invalid_type'),
          name: 'QA Invalid Type',
          type: 'invalid_type',
          defaultValue: true,
        },
      })
      expect(invalidTypeResponse.status(), 'invalid type should return 400').toBe(400)

      optionalToggleId = await createFeatureToggleFixture(request, token, {
        identifier: optionalIdentifier,
        name: 'QA Optional Toggle',
        description: 'Optional description',
        category: 'qa-optional',
        type: 'string',
        defaultValue: 'enabled',
      })

      const optionalDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(optionalToggleId)}`,
        { token },
      )
      expect(optionalDetailResponse.status()).toBe(200)
      const optionalDetail = await readJsonSafe<Record<string, unknown>>(optionalDetailResponse)
      expect(optionalDetail?.description).toBe('Optional description')
      expect(optionalDetail?.category).toBe('qa-optional')
      expect(optionalDetail?.defaultValue).toBe('enabled')

      const updateResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token,
        data: {
          id: validToggleId,
          name: 'QA Valid Toggle Updated',
          description: 'Updated description',
          category: 'qa-updated',
          defaultValue: false,
        },
      })
      expect(updateResponse.status()).toBe(200)

      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(validToggleId)}`,
        { token },
      )
      expect(verifyResponse.status()).toBe(200)
      const verifyBody = await readJsonSafe<Record<string, unknown>>(verifyResponse)
      expect(verifyBody?.name).toBe('QA Valid Toggle Updated')
      expect(verifyBody?.description).toBe('Updated description')
      expect(verifyBody?.category).toBe('qa-updated')
      expect(verifyBody?.defaultValue).toBe(false)
    } finally {
      await deleteFeatureToggleIfExists(request, token, validToggleId)
      await deleteFeatureToggleIfExists(request, token, optionalToggleId)
    }
  })
})
