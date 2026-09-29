import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph, setEnabled } from './helpers/marketing'

type Explanation = {
  wouldSend?: boolean
  decidedBy?: string | null
  campaign?: { isEnabled?: boolean }
  gates?: Array<{ gate: string; outcome: string; decisive: boolean; detail?: Record<string, unknown> }>
}

/**
 * TC-MA-037: "why didn't this customer get it?"
 *
 * The first question support asks, and the only one the module had no answer for: the results screen counts
 * suppressions and the run list explains a run that STARTED, while the case people ring up about is the one where
 * nothing happened at all.
 */
test.describe('TC-MA-037 explaining delivery', () => {
  async function anyCustomer(request: APIRequestContext, token: string) {
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    return people?.items?.[0]?.entityId ?? people?.items?.[0]?.id ?? null
  }

  test('a disabled campaign is the answer, because it is the commonest one', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await anyCustomer(request, token)
    test.skip(!customerId, 'no customer available in this installation')

    const campaignId = await createCampaign(request, token, `Explain disabled ${Date.now()}`)
    try {
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/explain`, {
        token,
        data: { subjectEntityId: customerId },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Explanation>(response)

      // A new campaign is disabled, and six green gates without mentioning that would be technically correct and
      // actively misleading.
      expect(body?.campaign?.isEnabled).toBe(false)
      expect(body?.wouldSend).toBe(false)
      expect(body?.decidedBy).toBe('campaignDisabled')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('every gate is reported, in the order the engine applies them', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await anyCustomer(request, token)
    test.skip(!customerId, 'no customer available in this installation')

    const campaignId = await createCampaign(request, token, `Explain gates ${Date.now()}`)
    try {
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/explain`, {
        token,
        data: { subjectEntityId: customerId },
      })
      const body = await readJsonSafe<Explanation>(response)
      /**
       * Permission before scheduling, and the order is the value: two gates are often both unhappy and only the
       * first is the answer somebody should go and fix.
       */
      expect((body?.gates ?? []).map((gate) => gate.gate)).toEqual([
        'audience', 'consent', 'pause', 'preferenceCap', 'quietHours', 'frequencyCap',
      ])
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an audience the customer is not in is named as the reason', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await anyCustomer(request, token)
    test.skip(!customerId, 'no customer available in this installation')

    const name = `Explain audience ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: {
          version: 1,
          // Nobody has ten thousand orders.
          audience: { operator: 'AND', rules: [{ field: 'orders.count', operator: '>=', value: 10000 }] },
          steps: [{ id: 'say-hi', type: 'send_email', params: { subject: 'Hi', bodyHtml: '<p>Hi</p>' } }],
        },
        // A campaign with no trigger is rightly refused publication: nothing could ever start it.
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
      })
      const beforeEnable = await getCampaign(request, token, campaignId)
      const enabled = await setEnabled(request, token, campaignId, { updatedAt: beforeEnable.updatedAt, isEnabled: true })
      // Asserted, because a silent refusal here made this test pass while explaining the wrong thing.
      expect(enabled.ok(), await enabled.text()).toBe(true)

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/explain`, {
        token,
        data: { subjectEntityId: customerId },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Explanation>(response)
      expect(body?.decidedBy).toBe('audience')
      expect(body?.gates?.find((gate) => gate.gate === 'audience')?.outcome).toBe('drop')
    } finally {
      // Switched off before deleting, so a failure mid-test cannot leave a live campaign behind.
      await getCampaign(request, token, campaignId)
        .then((current) => setEnabled(request, token, campaignId, { updatedAt: current.updatedAt, isEnabled: false }))
        .catch(() => undefined)
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('quiet hours defer rather than refuse, and say where the customer is', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const customerId = await anyCustomer(request, token)
    test.skip(!customerId, 'no customer available in this installation')

    const name = `Explain quiet ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: {
          version: 1,
          audience: null,
          steps: [{ id: 'say-hi', type: 'send_email', params: { subject: 'Hi', bodyHtml: '<p>Hi</p>' } }],
          // A window covering the whole day, so the answer does not depend on when the suite runs.
          sendPolicy: { frequencyCap: null, quietHours: { startHour: 0, endHour: 23 }, optimizeSendTime: false },
        },
        triggers: [],
      })

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/explain`, {
        token,
        data: { subjectEntityId: customerId },
      })
      const body = await readJsonSafe<Explanation>(response)
      const quiet = body?.gates?.find((gate) => gate.gate === 'quietHours')
      // "Later, not never" is a different answer from "no", and the shape says which.
      expect(quiet?.outcome).toBe('defer')
      // A window of 0–23 means nothing without knowing the customer's own hour.
      expect(typeof quiet?.detail?.localHour).toBe('number')
      expect(quiet?.detail?.timeZone).toBeTruthy()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an unknown customer and an unknown campaign are both 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `Explain 404 ${Date.now()}`)
    try {
      const unknownCustomer = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/explain`, {
        token,
        data: { subjectEntityId: '00000000-0000-4000-8000-000000000000' },
      })
      expect(unknownCustomer.status()).toBe(404)

      const unknownCampaign = await apiRequest(
        request,
        'POST',
        `${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/explain`,
        { token, data: { subjectEntityId: '00000000-0000-4000-8000-000000000001' } },
      )
      expect(unknownCampaign.status()).toBe(404)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an anonymous caller cannot ask about anybody', async ({ request }) => {
    const response = await request.post(
      `${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/explain`,
      { data: { subjectEntityId: '00000000-0000-4000-8000-000000000001' } },
    )
    expect([401, 403]).toContain(response.status())
  })
})
