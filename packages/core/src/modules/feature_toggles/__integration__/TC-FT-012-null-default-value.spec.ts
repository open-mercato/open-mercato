import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteFeatureToggleIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/featureTogglesFixtures'

type ListResponse = { items?: Array<{ id?: string; identifier?: string }> }

/**
 * TC-FT-012: creating a global toggle with an explicit `defaultValue: null`, or
 * without one, used to reach the NOT NULL `default_value` column and answer
 * 500 PERSISTENCE_ERROR. The create validator now refuses it with a 400 that
 * points at `defaultValue`, and nothing is stored.
 */
test.describe('TC-FT-012: feature toggle create without a default value', () => {
  for (const [label, extra] of [
    ['an explicit null', { defaultValue: null }],
    ['a missing', {}],
  ] as const) {
    test(`answers 400 for ${label} default value and stores nothing`, async ({ request }) => {
      const token = await getAuthToken(request, 'superadmin')
      const identifier = `qa_null_default_${Date.now()}`
      let leakedId: string | null = null

      try {
        const response = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
          token,
          data: { identifier, name: 'QA null default', type: 'boolean', ...extra },
        })
        expect(response.status()).toBe(400)
        const body = await readJsonSafe<{ details?: Array<{ path?: string[] }> }>(response)
        expect(body?.details?.map((issue) => issue.path?.join('.'))).toContain('defaultValue')

        const list = await apiRequest(
          request,
          'GET',
          `/api/feature_toggles/global?identifier=${encodeURIComponent(identifier)}&page=1&pageSize=10`,
          { token },
        )
        expect(list.status()).toBe(200)
        const items = (await readJsonSafe<ListResponse>(list))?.items ?? []
        leakedId = items.find((item) => item.identifier === identifier)?.id ?? null
        expect(leakedId).toBeNull()
      } finally {
        await deleteFeatureToggleIfExists(request, token, leakedId)
      }
    })
  }
})
