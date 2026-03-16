import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/featureTogglesFixtures'

test.describe('TC-FT-002: Feature toggle override APIs', () => {
  test('should list, inspect, change, and clear an override for the current tenant', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const identifier = `qa_override_${Date.now()}`
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Override Toggle',
        type: 'boolean',
        category: 'qa',
        defaultValue: true,
      })

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/overrides?identifier=${encodeURIComponent(identifier)}`,
        { token: superadminToken },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.toggleId === toggleId && item.isOverride === false)).toBe(true)

      const detailBeforeResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
        { token: superadminToken },
      )
      expect(detailBeforeResponse.status()).toBe(200)
      const detailBeforeBody = await readJsonSafe<{ value?: boolean; id?: string }>(detailBeforeResponse)
      expect(detailBeforeBody?.value).toBe(true)

      const updateResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
        token: superadminToken,
        data: {
          toggleId,
          isOverride: true,
          overrideValue: false,
        },
      })
      expect(updateResponse.status()).toBe(200)
      expect(updateResponse.headers()['x-om-operation']).toBeTruthy()

      const detailAfterResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
        { token: superadminToken },
      )
      const detailAfterBody = await readJsonSafe<{ value?: boolean; id?: string }>(detailAfterResponse)
      expect(detailAfterBody?.value).toBe(false)
      expect(typeof detailAfterBody?.id).toBe('string')

      const checkResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifier)}`,
        { token: adminToken },
      )
      expect(checkResponse.status()).toBe(200)
      const checkBody = await readJsonSafe<{
        ok?: boolean
        value?: boolean
        resolution?: { source?: string }
      }>(checkResponse)
      expect(checkBody?.ok).toBe(true)
      expect(checkBody?.value).toBe(false)
      expect(checkBody?.resolution?.source).toBe('override')

      const clearResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
        token: superadminToken,
        data: {
          toggleId,
          isOverride: false,
        },
      })
      expect(clearResponse.status()).toBe(200)

      const checkDefaultResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/check/boolean?identifier=${encodeURIComponent(identifier)}`,
        { token: adminToken },
      )
      const checkDefaultBody = await readJsonSafe<{
        ok?: boolean
        value?: boolean
        resolution?: { source?: string }
      }>(checkDefaultResponse)
      expect(checkDefaultBody?.ok).toBe(true)
      expect(checkDefaultBody?.value).toBe(true)
      expect(checkDefaultBody?.resolution?.source).toBe('default')
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })
})
