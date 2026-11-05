import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import {
  changeOverrideState,
  countOverridesForToggleInDb,
  uniqueToggleIdentifier,
} from './featureToggleTestHelpers'

test.describe('TC-FT-009: Soft delete and override preservation', () => {
  test('hides deleted toggles while keeping identifiers and override history reserved', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const identifier = uniqueToggleIdentifier('qa_delete')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Delete Toggle',
        type: 'boolean',
        defaultValue: true,
      })

      const overrideResponse = await changeOverrideState(request, adminToken, {
        toggleId,
        isOverride: true,
        overrideValue: false,
      })
      expect(overrideResponse.status()).toBe(200)

      const overrideDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}/override`,
        { token: adminToken },
      )
      expect(overrideDetailResponse.status()).toBe(200)
      const overrideDetail = await readJsonSafe<{ value?: boolean }>(overrideDetailResponse)
      expect(overrideDetail?.value).toBe(false)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/feature_toggles/global?id=${encodeURIComponent(toggleId)}`,
        { token: superadminToken },
      )
      expect(deleteResponse.status()).toBe(200)

      const deletedDetailResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}`,
        { token: superadminToken },
      )
      expect(deletedDetailResponse.status()).toBe(404)

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global?identifier=${encodeURIComponent(identifier)}&pageSize=200`,
        { token: superadminToken },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === toggleId)).toBe(false)

      const recreateResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token: superadminToken,
        data: {
          identifier,
          name: 'QA Delete Toggle Recreated',
          type: 'boolean',
          defaultValue: true,
        },
      })
      expect(recreateResponse.status()).toBe(400)

      await expect(countOverridesForToggleInDb(toggleId)).resolves.toBe(1)
      toggleId = null
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })
})
