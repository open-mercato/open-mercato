import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/featureTogglesFixtures'

/**
 * TC-FT-003 (QA round-6, PR #2055): the feature-toggle identifier validator
 * previously rejected dots and dashes, so editing a seeded namespaced toggle
 * such as `customers.interactions.legacy-adapters` failed with a 400. The
 * relaxed `IDENTIFIER_PATTERN` (`/^[a-z][a-z0-9_.-]*$/`) accepts dots and
 * dashes; this spec proves create + edit of a dotted+dashed identifier
 * round-trips through the API.
 */
test.describe('TC-FT-003: feature toggle identifiers allow dots and dashes', () => {
  test('creates and edits a global toggle with a dotted+dashed namespaced identifier', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const identifier = `qa.lock-round6.legacy-adapters-${Date.now()}`
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, token, {
        identifier,
        name: 'QA dotted identifier',
        description: 'Initial description',
        category: 'qa',
        type: 'boolean',
        defaultValue: true,
      })
      expect(toggleId, 'a dotted+dashed identifier should be accepted on create').toBeTruthy()

      // Edit only the description — this is exactly the QA repro that 400'd
      // before because the unchanged dotted identifier failed validation.
      const updateResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token,
        data: {
          id: toggleId,
          identifier,
          name: 'QA dotted identifier',
          description: 'Updated description only',
          type: 'boolean',
          defaultValue: true,
        },
      })
      expect(updateResponse.status(), 'editing a dotted-identifier toggle should succeed').toBe(200)

      const verify = await apiRequest(
        request,
        'GET',
        `/api/feature_toggles/global/${encodeURIComponent(toggleId)}`,
        { token },
      )
      expect(verify.status()).toBe(200)
      const item = await readJsonSafe<Record<string, unknown>>(verify)
      expect(item?.identifier).toBe(identifier)
      expect(item?.description).toBe('Updated description only')
    } finally {
      await deleteFeatureToggleIfExists(request, token, toggleId)
    }
  })
})
