import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCampaign, deleteCampaignIfExists, getCampaign, PALETTE_PATH, saveGraph } from './helpers/marketing'

type PaletteStep = { type?: string; channel?: string | null; uiFields?: Array<{ name?: string; kind?: string }> }

/**
 * TC-MA-033: telling a colleague, and telling an outside system.
 *
 * The two steps that let a journey reach somebody other than the customer. Both are authored through the
 * inspector, so what matters here is that each is offered with a usable form and that a campaign built from
 * them saves — a step the palette does not offer is a step only its author knows exists.
 */
test.describe('TC-MA-033 notify and signal steps', () => {
  test('both steps are offered with an editable form', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    expect(response.ok(), await response.text()).toBe(true)
    const body = await readJsonSafe<{ steps?: PaletteStep[] }>(response)
    const steps = new Map((body?.steps ?? []).map((entry) => [entry.type, entry]))

    const notify = steps.get('notify')
    expect(notify, 'notify must be offered').toBeTruthy()
    // A select for the audience, or an author cannot choose between the owner and the team.
    expect((notify?.uiFields ?? []).map((field) => `${field.name}:${field.kind}`)).toEqual(
      expect.arrayContaining(['audience:select', 'message:textarea']),
    )
    // Neither step has a channel: they reach a colleague and a system, never the customer.
    expect(notify?.channel ?? null).toBeNull()

    const signal = steps.get('send_signal')
    expect(signal, 'send_signal must be offered').toBeTruthy()
    expect((signal?.uiFields ?? []).map((field) => `${field.name}:${field.kind}`)).toEqual(
      expect.arrayContaining(['topic:text', 'data:textarea']),
    )
    expect(signal?.channel ?? null).toBeNull()
  })

  test('a campaign using both saves and reads back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Escalate a detractor ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'survey.nps', operator: '<=', value: 6 }] },
          steps: [
            { id: 'notify-owner', type: 'notify', params: { audience: 'owner', message: 'Unhappy customer, please call.', severity: 'warning' } },
            { id: 'tell-crm', type: 'send_signal', params: { topic: 'vip.unhappy', data: 'score={{survey.nps}}' } },
          ],
        },
        triggers: [],
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const readBack = await getCampaign(request, token, campaignId)
      expect(readBack.definition.steps.map((step) => step.type)).toEqual(['notify', 'send_signal'])
      /**
       * The definition stores what the AUTHOR typed, and the step parses it when it runs.
       *
       * That is the platform's save contract — params are validated on save and stored as written — and it is
       * why the schema accepts both shapes: a person types `key=value` lines into the one multi-line field the
       * inspector has, while a tool or the API passes the map directly. Both reach the receiver as a map,
       * because parsing happens at execute time; the unit tests pin that half.
       */
      expect(readBack.definition.steps[1].params.data).toBe('score={{survey.nps}}')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a malformed topic is refused at save time, not at send time', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Bad topic ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: {
          version: 1,
          audience: null,
          steps: [{ id: 'bad', type: 'send_signal', params: { topic: 'has spaces and "quotes"' } }],
        },
        triggers: [],
      })
      // A campaign that looks saved and posts a topic nobody can match on is the failure this refuses.
      expect(saved.status()).toBe(400)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the outbound event is declared, so an operator can subscribe an endpoint to it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    // The webhooks module offers exactly the declared platform events; a signal nobody can subscribe to is a
    // step that does nothing an operator can observe.
    const response = await apiRequest(request, 'GET', '/api/webhooks/events', { token })
    if (!response.ok()) {
      test.skip(true, 'the webhooks module is not installed in this app')
      return
    }
    const body = await readJsonSafe<{ data?: Array<{ id?: string }> }>(response)
    const ids = (body?.data ?? []).map((entry) => entry.id)
    expect(ids).toContain('marketing_automation.campaign.signalled')
  })
})
