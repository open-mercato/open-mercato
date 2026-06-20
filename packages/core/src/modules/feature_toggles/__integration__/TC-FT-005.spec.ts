import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { rawApiRequest, uniqueToggleIdentifier } from './featureToggleTestHelpers'

test.describe('TC-FT-005: Authorization and permission enforcement on global toggles', () => {
  test('enforces auth, view, and global manage permissions', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const identifier = uniqueToggleIdentifier('qa_auth')
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, superadminToken, {
        identifier,
        name: 'QA Auth Toggle',
        type: 'boolean',
        defaultValue: true,
      })

      const unauthenticatedListResponse = await rawApiRequest(request, 'GET', '/api/feature_toggles/global')
      expect(unauthenticatedListResponse.status()).toBe(401)

      const unauthenticatedCreateResponse = await rawApiRequest(request, 'POST', '/api/feature_toggles/global', {
        data: {
          identifier: uniqueToggleIdentifier('qa_auth_no_token'),
          name: 'QA Auth No Token',
          type: 'boolean',
          defaultValue: true,
        },
      })
      expect(unauthenticatedCreateResponse.status()).toBe(401)

      const employeeCreateResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token: employeeToken,
        data: {
          identifier: uniqueToggleIdentifier('qa_auth_employee'),
          name: 'QA Auth Employee',
          type: 'boolean',
          defaultValue: true,
        },
      })
      expect(employeeCreateResponse.status()).toBe(403)

      const adminListResponse = await apiRequest(request, 'GET', '/api/feature_toggles/global?page=1&pageSize=5', {
        token: adminToken,
      })
      expect(adminListResponse.status()).toBe(200)

      const adminCreateResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token: adminToken,
        data: {
          identifier: uniqueToggleIdentifier('qa_auth_admin'),
          name: 'QA Auth Admin',
          type: 'boolean',
          defaultValue: true,
        },
      })
      expect(adminCreateResponse.status()).toBe(403)

      const adminUpdateResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token: adminToken,
        data: {
          id: toggleId,
          name: 'QA Auth Admin Update',
        },
      })
      expect(adminUpdateResponse.status()).toBe(403)

      const adminDeleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/feature_toggles/global?id=${encodeURIComponent(toggleId)}`,
        { token: adminToken },
      )
      expect(adminDeleteResponse.status()).toBe(403)

      const superadminUpdateResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token: superadminToken,
        data: {
          id: toggleId,
          name: 'QA Auth Toggle Updated',
        },
      })
      expect(superadminUpdateResponse.status()).toBe(200)

      const superadminDeleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/feature_toggles/global?id=${encodeURIComponent(toggleId)}`,
        { token: superadminToken },
      )
      expect(superadminDeleteResponse.status()).toBe(200)
      const deletedToggleId = toggleId
      toggleId = null

      const detailAfterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(deletedToggleId)}`,
        { token: superadminToken },
      )
      expect(detailAfterDeleteResponse.status()).toBe(404)
    } finally {
      await deleteFeatureToggleIfExists(request, superadminToken, toggleId)
    }
  })
})
