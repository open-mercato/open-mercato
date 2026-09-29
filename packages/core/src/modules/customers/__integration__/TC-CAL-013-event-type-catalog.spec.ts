import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

type Catalog = { fallbackKey: string; items: Array<{ key: string; selectable: boolean; behavior: { baseKind: string }; source: string }> }

test.describe('TC-CAL-013: scoped event-type catalog and command enforcement', () => {
  test('publishes effective types and rejects an unknown key through the interaction API', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    let meetingId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const catalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(catalogResponse.status(), await catalogResponse.text()).toBe(200)
      const catalog = await catalogResponse.json() as Catalog
      expect(catalog.fallbackKey).toBe('meeting')
      expect(catalog.items.find((item) => item.key === 'meeting')).toMatchObject({ selectable: true, behavior: { baseKind: 'meeting' } })
      expect(new Set(catalog.items.map((item) => item.key)).size).toBe(catalog.items.length)

      personId = await createPersonFixture(request, token, {
        firstName: 'Calendar', lastName: `Type${Date.now()}`, displayName: `Calendar type QA ${Date.now()}`,
      })
      const rejected = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: personId, interactionType: 'qa_unregistered_type', title: 'Should be rejected' },
      })
      expect(rejected.status()).toBe(400)
      expect(await rejected.json()).toMatchObject({ code: 'activity_type_unavailable' })

      const accepted = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: personId, interactionType: 'meeting', title: 'Known catalog type' },
      })
      expect(accepted.status(), await accepted.text()).toBe(201)
      meetingId = (await accepted.json() as { id?: string }).id ?? null
      expect(meetingId).toBeTruthy()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', meetingId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
