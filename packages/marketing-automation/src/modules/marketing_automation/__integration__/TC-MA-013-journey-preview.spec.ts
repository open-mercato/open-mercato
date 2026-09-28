import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

type Preview = {
  entered: boolean
  entries: Array<{
    kind: 'step' | 'pause'
    at: string
    until?: string
    reason?: string
    stepId?: string
    type?: string
    status?: string
    detail?: string | null
    channel?: string | null
  }>
  stoppedBecause: string
  variantChoices: Record<string, string>
  endsAt: string | null
}

const email = (id: string) => ({ id, type: 'send_email', params: { subject: 'x', bodyHtml: '<p>x</p>' } })

/**
 * TC-MA-013: the journey preview.
 *
 * It drives the REAL engine with recording effects, so what matters is that it stays a preview: no
 * message goes out, nothing is recorded, and the answer still reflects the gates. The timestamps depend
 * on the installation's clock, so the assertions are about ORDER and SHAPE, not exact values.
 */
test.describe('TC-MA-013 journey preview', () => {
  async function customerId(request: Parameters<typeof apiRequest>[0], token: string): Promise<string | null> {
    const response = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    if (!response.ok()) return null
    const body = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(response)
    return body?.items?.[0]?.entityId ?? body?.items?.[0]?.id ?? null
  }

  test('predicts a chain of steps in order, and sends nothing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      const subjectEntityId = await customerId(request, token)
      test.skip(!subjectEntityId, 'no customer available in this installation')

      campaignId = await createCampaign(request, token, `QA preview ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA preview',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [email('s1'), { id: 'w1', type: 'wait', params: { minutes: 1440 } }, email('s2')],
        },
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/preview`, {
        token,
        data: { subjectEntityId },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const preview = await readJsonSafe<Preview>(response)

      expect(preview?.entered).toBe(true)
      // A wait is consumed by the planner, so it is reported as a PAUSE between the two sends rather
      // than as a step of its own.
      expect(preview?.entries.map((entry) => entry.kind)).toEqual(['step', 'pause', 'step'])
      expect(preview?.entries.filter((entry) => entry.kind === 'step').map((entry) => entry.stepId)).toEqual(['s1', 's2'])
      expect(preview?.entries[1].reason).toBe('wait')
      // The wait is followed rather than stopping the preview: the second message is a day later.
      const first = new Date(preview!.entries[0].at).getTime()
      const last = new Date(preview!.entries[2].at).getTime()
      expect(last - first).toBeGreaterThanOrEqual(86_400_000 - 60_000)
      expect(preview?.stoppedBecause).toBe('completed')

      // Nothing was recorded: the campaign's own report still shows no traffic.
      const tracking = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/tracking`, { token })
      const counts = await readJsonSafe<{ sends?: { sent?: number } }>(tracking)
      expect(counts?.sends?.sent).toBe(0)

      // And no run was created — a preview is not an enrolment.
      const runs = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/runs`, { token })
      const runBody = await readJsonSafe<{ total?: number }>(runs)
      expect(runBody?.total).toBe(0)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('says plainly when the audience would turn the customer away', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      const subjectEntityId = await customerId(request, token)
      test.skip(!subjectEntityId, 'no customer available in this installation')

      campaignId = await createCampaign(request, token, `QA preview excluded ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA preview excluded',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'tags', operator: 'CONTAINS', value: `absent-${Date.now()}` }] },
          steps: [email('s1')],
        },
      })

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/preview`, {
        token,
        data: { subjectEntityId },
      })
      const preview = await readJsonSafe<Preview>(response)
      expect(preview?.entered).toBe(false)
      expect(preview?.entries).toEqual([])
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('reports which A/B lane the customer would take', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      const subjectEntityId = await customerId(request, token)
      test.skip(!subjectEntityId, 'no customer available in this installation')

      campaignId = await createCampaign(request, token, `QA preview split ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA preview split',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{
            id: 'sp1',
            type: 'split',
            params: { variants: [{ key: 'a', weight: 1, steps: [email('a1')] }, { key: 'b', weight: 1, steps: [email('b1')] }] },
          }],
        },
      })

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/preview`, {
        token,
        data: { subjectEntityId },
      })
      const preview = await readJsonSafe<Preview>(response)
      const chosen = preview?.variantChoices.sp1
      expect(['a', 'b']).toContain(chosen)
      // Exactly the chosen lane's step, and only it.
      expect(preview?.entries.filter((entry) => entry.kind === 'step').map((entry) => entry.stepId)).toEqual([`${chosen}1`])
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('refuses a body that is not a customer id', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA preview invalid ${Date.now()}`)
      for (const data of [{}, { subjectEntityId: 'not-a-uuid' }]) {
        const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/preview`, { token, data })
        expect(response.status(), JSON.stringify(data)).toBe(400)
      }
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('rejects an unauthenticated request', async ({ request }) => {
    const response = await request.post(`${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/preview`, {
      data: { subjectEntityId: '00000000-0000-4000-8000-000000000000' },
    })
    expect([401, 403]).toContain(response.status())
  })
})
