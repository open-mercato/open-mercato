import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { changeOverrideState, uniqueToggleIdentifier } from './featureToggleTestHelpers'

test.describe('TC-FT-010: Override state transitions and cache invalidation', () => {
  test('updates check results immediately when an override is set and cleared', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const identifier = uniqueToggleIdentifier('qa_cache')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Cache Toggle',
        type: 'boolean',
        defaultValue: true,
      })

      const defaultCheckResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifier)}`,
        { token: adminToken },
      )
      expect(defaultCheckResponse.status()).toBe(200)
      const defaultCheck = await readJsonSafe<{ value?: boolean; resolution?: { source?: string } }>(
        defaultCheckResponse,
      )
      expect(defaultCheck?.value).toBe(true)
      expect(defaultCheck?.resolution?.source).toBe('default')

      const setOverrideResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: false,
      })
      expect(setOverrideResponse.status()).toBe(200)
      expect(setOverrideResponse.headers()['x-om-operation']).toBeTruthy()

      const overrideCheckResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifier)}`,
        { token: adminToken },
      )
      expect(overrideCheckResponse.status()).toBe(200)
      const overrideCheck = await readJsonSafe<{ value?: boolean; resolution?: { source?: string } }>(
        overrideCheckResponse,
      )
      expect(overrideCheck?.value).toBe(false)
      expect(overrideCheck?.resolution?.source).toBe('override')

      const overrideDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
        { token: adminToken },
      )
      expect(overrideDetailResponse.status()).toBe(200)
      const overrideDetail = await readJsonSafe<{ value?: boolean }>(overrideDetailResponse)
      expect(overrideDetail?.value).toBe(false)

      const clearOverrideResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: false,
      })
      expect(clearOverrideResponse.status()).toBe(200)

      const clearedCheckResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifier)}`,
        { token: adminToken },
      )
      expect(clearedCheckResponse.status()).toBe(200)
      const clearedCheck = await readJsonSafe<{ value?: boolean; resolution?: { source?: string } }>(
        clearedCheckResponse,
      )
      expect(clearedCheck?.value).toBe(true)
      expect(clearedCheck?.resolution?.source).toBe('default')

      const clearedDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
        { token: adminToken },
      )
      expect(clearedDetailResponse.status()).toBe(200)
      const clearedDetail = await readJsonSafe<{ id?: string; value?: boolean }>(clearedDetailResponse)
      expect(clearedDetail?.id).toBe('')
      expect(clearedDetail?.value).toBe(true)
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })
})
