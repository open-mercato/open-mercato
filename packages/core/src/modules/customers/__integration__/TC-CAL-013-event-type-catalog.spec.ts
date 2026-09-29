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

  test('requires confirmation before a type switch discards stored values', async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    let meetingId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, {
        firstName: 'Calendar', lastName: `Switch${Date.now()}`, displayName: `Calendar switch QA ${Date.now()}`,
      })
      const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personId, interactionType: 'meeting', title: 'Type switch QA',
          scheduledAt: '2026-10-05T09:00:00.000Z', durationMinutes: 60, location: 'Office',
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      meetingId = (await created.json() as { id?: string }).id ?? null
      expect(meetingId).toBeTruthy()

      const proposed = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: meetingId, interactionType: 'task' },
      })
      expect(proposed.status(), await proposed.text()).toBe(409)
      expect(await proposed.json()).toMatchObject({
        code: 'calendar_type_change_confirmation_required',
        fields: expect.arrayContaining(['durationMinutes', 'location']),
      })

      const confirmed = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: meetingId, interactionType: 'task', confirmDiscardInapplicableValues: true },
      })
      expect(confirmed.status(), await confirmed.text()).toBe(200)
      const list = await apiRequest(request, 'GET', '/api/customers/interactions?entityId=' + personId +
        '&from=2026-10-05T00%3A00%3A00Z&to=2026-10-06T00%3A00%3A00Z', { token })
      expect(list.status(), await list.text()).toBe(200)
      const row = ((await list.json()) as { items?: Array<{ id: string; interactionType: string; durationMinutes?: number | null; location?: string | null }> })
        .items?.find((item) => item.id === meetingId)
      expect(row).toMatchObject({ interactionType: 'task', durationMinutes: null, location: null })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', meetingId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
