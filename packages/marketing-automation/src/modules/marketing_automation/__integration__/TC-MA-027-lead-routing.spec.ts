import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const SETTINGS_PATH = '/api/marketing_automation/settings'
const ROUTING_PATH = '/api/marketing_automation/lead-routing'

type Settings = { leadRoutingUserIds?: string[] }

/**
 * TC-MA-027: lead routing.
 *
 * The pool is configuration, so the assertions are about the contract around it: the pool round-trips and is
 * de-duplicated, the routing view reports each rep in it, and the step is offered with its one parameter.
 */
test.describe('TC-MA-027 lead routing', () => {
  test('the rep pool round-trips, de-duplicated', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const before = await readJsonSafe<Settings>(await apiRequest(request, 'GET', SETTINGS_PATH, { token }))
    const rep = '11111111-1111-4111-8111-111111111111'

    try {
      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        // The same rep twice: listed twice they would halve everybody else's share.
        data: { leadRoutingUserIds: [rep, rep] },
      })
      expect(saved.status()).toBe(200)
      expect((await readJsonSafe<Settings>(saved))?.leadRoutingUserIds).toEqual([rep])

      const routing = await apiRequest(request, 'GET', ROUTING_PATH, { token })
      expect(routing.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<{ userId?: string; totalOwned?: number; newLeads?: unknown[] }>; windowDays?: number }>(routing)
      const row = (body?.items ?? []).find((item) => item.userId === rep)
      expect(row).toBeTruthy()
      // Nobody is assigned to this made-up rep, so both figures are zero — and present rather than absent.
      expect(row?.totalOwned).toBe(0)
      expect(Array.isArray(row?.newLeads)).toBe(true)
      expect(body?.windowDays).toBe(7)
    } finally {
      await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { leadRoutingUserIds: before?.leadRoutingUserIds ?? [] },
      })
    }
  })

  test('an empty pool answers an empty routing view rather than an error', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const before = await readJsonSafe<Settings>(await apiRequest(request, 'GET', SETTINGS_PATH, { token }))
    try {
      await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: { leadRoutingUserIds: [] } })
      const routing = await apiRequest(request, 'GET', ROUTING_PATH, { token })
      expect(routing.status()).toBe(200)
      expect((await readJsonSafe<{ items?: unknown[] }>(routing))?.items).toEqual([])
    } finally {
      await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { leadRoutingUserIds: before?.leadRoutingUserIds ?? [] },
      })
    }
  })

  test('a pool entry that is not a user id is refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
      token,
      data: { leadRoutingUserIds: ['not-a-uuid'] },
    })
    expect(response.status()).toBe(400)
  })

  test('the palette offers the assignment step with its reassign switch', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const body = await readJsonSafe<{ steps?: Array<{ type?: string; uiFields?: Array<{ name?: string; kind?: string }> }> }>(
      await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token }),
    )
    const step = (body?.steps ?? []).find((entry) => entry.type === 'assign_owner')
    expect(step).toBeTruthy()
    const field = (step?.uiFields ?? []).find((entry) => entry.name === 'reassign')
    expect(field?.kind).toBe('boolean')
  })

  test('an anonymous caller cannot read lead routing', async ({ request }) => {
    expect([401, 403]).toContain((await request.get(ROUTING_PATH)).status())
  })
})
