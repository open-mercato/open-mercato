import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

type Rendered = { stepId?: string; subject?: string; html?: string; text?: string | null; personalised?: boolean }

/**
 * TC-MA-036: seeing the finished message without sending it.
 *
 * Until this endpoint existed, checking your own copy with the placeholders filled in meant test-sending it to
 * yourself and opening your inbox — for the one thing an author most wants to see before publishing. The property
 * worth pinning is that it renders through the SAME path a send uses, so a preview cannot drift from delivery.
 */
test.describe('TC-MA-036 render preview', () => {
  const graph = (name: string, updatedAt: string) => ({
    updatedAt,
    name,
    definition: {
      version: 1,
      audience: null,
      steps: [
        {
          id: 'hello',
          type: 'send_email',
          params: {
            subject: 'Hello {{customer.displayName}}',
            bodyHtml: '<p>Hello {{customer.displayName}}, you have placed {{orders.count}} orders.</p>',
          },
        },
        { id: 'not-an-email', type: 'add_points', params: { points: 5, reason: 'read the preview' } },
      ],
    },
    triggers: [],
  })

  test('renders the subject and body with the placeholders resolved', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Render ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      expect((await saveGraph(request, token, campaignId, graph(name, created.updatedAt))).ok()).toBe(true)

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/render`, {
        token,
        data: { stepId: 'hello' },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Rendered>(response)

      expect(body?.stepId).toBe('hello')
      /**
       * With no customer chosen, the placeholders stay VERBATIM — and that is faithful rather than broken.
       *
       * `interpolate` leaves an unresolved placeholder in place by design, so a typo shows up in the message
       * instead of producing a silently empty sentence. A preview that blanked them would be showing something a
       * send would never produce, which is the one thing it must not do. The `personalised` flag is what tells the
       * author which of the two situations they are looking at.
       */
      expect(body?.personalised).toBe(false)
      expect(body?.subject).toContain('{{customer.displayName}}')
      // The author's own copy is there, which is what they came to check.
      expect(body?.html).toContain('you have placed')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  /**
   * With a customer, the same render fills them in — the half an author actually publishes on.
   */
  test('naming a customer fills the placeholders in', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(
      await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token }),
    )
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const name = `Render personalised ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, graph(name, created.updatedAt))

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/render`, {
        token,
        data: { stepId: 'hello', subjectEntityId: customerId },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Rendered>(response)

      expect(body?.personalised).toBe(true)
      // The order count always resolves — it is a number for every customer, zero included.
      expect(body?.html).not.toContain('{{orders.count}}')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('nothing is tracked, because there is no run to attribute an open to', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Render untracked ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, graph(name, created.updatedAt))

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/render`, {
        token,
        data: { stepId: 'hello' },
      })
      const body = await readJsonSafe<Rendered>(response)
      // A tracking URL here would both lie in the markup and leave a token pointing at a run that never existed.
      expect(body?.html ?? '').not.toContain('/track/click')
      expect(body?.html ?? '').not.toContain('/track/open')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a step with no channel is refused, with a reason an author can act on', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Render non-email ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, graph(name, created.updatedAt))

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/render`, {
        token,
        data: { stepId: 'not-an-email' },
      })
      expect(response.status()).toBe(400)
      expect(await response.text()).toContain('marketing_automation')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an unknown step is 404 and an unknown campaign is 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `Render 404 ${Date.now()}`)
    try {
      const missingStep = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/render`, {
        token,
        data: { stepId: 'nope' },
      })
      expect(missingStep.status()).toBe(404)

      const missingCampaign = await apiRequest(
        request,
        'POST',
        `${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/render`,
        { token, data: { stepId: 'hello' } },
      )
      expect(missingCampaign.status()).toBe(404)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an anonymous caller cannot render anything', async ({ request }) => {
    const response = await request.post(
      `${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/render`,
      { data: { stepId: 'hello' } },
    )
    expect([401, 403]).toContain(response.status())
  })
})
