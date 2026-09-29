import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists } from './helpers/marketing'

const OVERVIEW_PATH = '/api/marketing_automation/dashboard/overview'

type Funnel = {
  stages: Array<{ key: string; people: number; conversionFromPrevious: number | null; shareOfEntered: number | null }>
  hasEngagementData: boolean
}

/**
 * TC-MA-031: the campaign funnel and the organisation-wide dashboard read.
 *
 * Both are pure reads over data other tests create, so what is asserted here is the CONTRACT: the stages the
 * screen expects, in order, counted in people; the honest nulls where there is nobody to divide by; and a
 * dashboard endpoint that answers without a campaign id and refuses an anonymous caller.
 */
test.describe('TC-MA-031 funnel and dashboard overview', () => {
  test('the results endpoint answers with the five funnel stages, in order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `Funnel shape ${Date.now()}`)
    try {
      const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/tracking`, { token })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<{ funnel?: Funnel }>(response)

      expect(body?.funnel?.stages.map((stage) => stage.key)).toEqual([
        'entered', 'sent', 'opened', 'clicked', 'converted',
      ])
      // There is deliberately no `delivered` stage: the platform has no provider feedback, so it could only
      // be the sent count wearing a more confident name.
      expect(body?.funnel?.stages.map((stage) => stage.key)).not.toContain('delivered')

      // A campaign nobody has entered reports zeroes with NULL rates — a rate over nobody is not zero.
      const [entered] = body?.funnel?.stages ?? []
      expect(entered?.people).toBe(0)
      expect(entered?.conversionFromPrevious).toBeNull()
      for (const stage of body?.funnel?.stages ?? []) {
        expect(stage.conversionFromPrevious).toBeNull()
      }
      expect(body?.funnel?.hasEngagementData).toBe(false)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a campaign from another organization is 404, not a funnel of zeroes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      `${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/tracking`,
      { token },
    )
    expect(response.status()).toBe(404)
  })

  test('the dashboard read answers for the whole organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', `${OVERVIEW_PATH}?days=30`, { token })
    expect(response.ok(), await response.text()).toBe(true)
    const body = await readJsonSafe<{
      windowDays?: number
      campaigns?: { enabled: number; total: number }
      sends?: { sent: number; suppressed: number; failed: number }
      engagement?: { opened: number; clicked: number }
      revenue?: unknown[]
      runs?: number
    }>(response)

    expect(body?.windowDays).toBe(30)
    expect(typeof body?.campaigns?.total).toBe('number')
    expect(typeof body?.sends?.sent).toBe('number')
    // Suppressed and failed are separate facts: a gate doing its job is not a transport refusing.
    expect(typeof body?.sends?.suppressed).toBe('number')
    expect(typeof body?.sends?.failed).toBe('number')
    expect(typeof body?.engagement?.clicked).toBe('number')
    expect(Array.isArray(body?.revenue)).toBe(true)
  })

  test('the window is clamped rather than trusted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tooLong = await apiRequest(request, 'GET', `${OVERVIEW_PATH}?days=9999`, { token })
    expect(tooLong.ok()).toBe(true)
    expect((await readJsonSafe<{ windowDays?: number }>(tooLong))?.windowDays).toBe(90)

    const nonsense = await apiRequest(request, 'GET', `${OVERVIEW_PATH}?days=not-a-number`, { token })
    expect(nonsense.ok()).toBe(true)
    // Falls back to the default rather than answering about an accidental period.
    expect((await readJsonSafe<{ windowDays?: number }>(nonsense))?.windowDays).toBe(7)
  })

  test('an anonymous caller cannot read the dashboard figures', async ({ request }) => {
    const response = await request.get(OVERVIEW_PATH)
    expect([401, 403]).toContain(response.status())
  })
})
