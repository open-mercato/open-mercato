import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, PALETTE_PATH, saveGraph } from './helpers/marketing'

type PaletteTrigger = { eventId?: string; available?: boolean; contextKeys?: string[]; labelKey?: string }

/**
 * TC-MA-032: the commerce lifecycle triggers.
 *
 * Seven events that existed on the platform and that no campaign could react to. What matters operationally is
 * that each is OFFERED with the context an audience needs and that a campaign authored against one saves — a
 * trigger the palette hides, or accepts and cannot hydrate, is a feature only its author knows about.
 */
const EXPECTED = [
  'customers.tag.removed',
  'sales.order.confirmed',
  'sales.invoice.created',
  'payment_gateways.payment.captured',
  'sales.payment.created',
  'customers.deal.won',
  'customers.deal.lost',
]

test.describe('TC-MA-032 lifecycle triggers', () => {
  test('every new trigger is offered for authoring', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    expect(response.ok(), await response.text()).toBe(true)
    const body = await readJsonSafe<{ triggers?: PaletteTrigger[] }>(response)
    const offered = new Map((body?.triggers ?? []).map((entry) => [entry.eventId, entry]))

    for (const eventId of EXPECTED) {
      const entry = offered.get(eventId)
      expect(entry, `${eventId} must be in the palette`).toBeTruthy()
      expect(entry?.available, `${eventId} must be authorable`).toBe(true)
    }
  })

  test('each carries the context an audience would compare', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    const body = await readJsonSafe<{ triggers?: PaletteTrigger[] }>(response)
    const offered = new Map((body?.triggers ?? []).map((entry) => [entry.eventId, entry]))

    // An invoice campaign is about what is owed; a deal campaign is about what it was worth. A trigger with no
    // context keys can still start a run, but the author has nothing to write a condition against.
    expect(offered.get('sales.invoice.created')?.contextKeys).toContain('trigger.outstanding')
    expect(offered.get('payment_gateways.payment.captured')?.contextKeys).toContain('trigger.amount')
    expect(offered.get('customers.deal.won')?.contextKeys).toContain('trigger.dealValue')
    expect(offered.get('sales.order.confirmed')?.contextKeys).toContain('trigger.previousStatus')
    expect(offered.get('customers.tag.removed')?.contextKeys).toContain('trigger.tagId')
  })

  test('a campaign authored against a lifecycle trigger saves and reads back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Deal won follow-up ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: {
          version: 1,
          // A deal worth something, closed as won: the B2B case the module could not express at all before.
          audience: { operator: 'AND', rules: [{ field: 'trigger.dealValue', operator: '>=', value: 1000 }] },
          steps: [],
        },
        triggers: [{ kind: 'event', eventId: 'customers.deal.won' }],
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const readBack = await getCampaign(request, token, campaignId)
      expect(readBack.triggers).toHaveLength(1)
      expect(readBack.triggers[0]).toMatchObject({ kind: 'event', eventId: 'customers.deal.won' })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  /**
   * The reorder sweep, which an author picks as a SCHEDULE rather than an event.
   *
   * Offered as a sweep source and present in the trigger catalog as unavailable — there is nothing to subscribe
   * to, and the catalog entry exists so the audience builder offers `trigger.sku` and `trigger.cycleDays`, which
   * are what make "your coffee usually lasts you about a month" writable.
   */
  test('the reorder source is offered as a schedule with the copy context', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    expect(response.ok(), await response.text()).toBe(true)
    const body = await readJsonSafe<{
      sweepSources?: Array<{ id?: string; available?: boolean; contextKeys?: string[]; defaultWithinDays?: number }>
      triggers?: PaletteTrigger[]
    }>(response)

    const source = (body?.sweepSources ?? []).find((entry) => entry.id === 'reorder_due')
    expect(source, 'reorder_due must be offered as a sweep source').toBeTruthy()
    expect(source?.available).toBe(true)
    expect(source?.contextKeys).toEqual(expect.arrayContaining(['trigger.sku', 'trigger.cycleDays']))
    // The parameter is a PERCENTAGE of the cycle here, not a window of days, so a sensible default matters.
    expect(source?.defaultWithinDays).toBeGreaterThan(0)

    const trigger = (body?.triggers ?? []).find((entry) => entry.eventId === 'marketing_automation.product.reorder_due')
    expect(trigger, 'the synthetic trigger must be in the catalog').toBeTruthy()
    expect(trigger?.available).toBe(false)
  })

  test('a campaign can be scheduled against the reorder source', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Reorder reminder ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: { version: 1, audience: null, steps: [] },
        triggers: [{
          kind: 'schedule',
          scheduleValue: '1d',
          sweepSource: 'reorder_due',
          sweepParams: { withinDays: 15 },
          reentryAfterDays: null,
        }],
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const readBack = await getCampaign(request, token, campaignId)
      expect(readBack.triggers[0]).toMatchObject({ kind: 'schedule', sweepSource: 'reorder_due' })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a made-up event id is still refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Bogus trigger ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: { version: 1, audience: null, steps: [] },
        triggers: [{ kind: 'event', eventId: 'sales.invoice.issued' }],
      })
      // `sales.invoice.issued` does not exist on the platform — checked, not assumed — so accepting it would
      // save a campaign that can never fire.
      expect(saved.status()).toBe(400)
      expect(await saved.text()).toContain('marketing_automation')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
