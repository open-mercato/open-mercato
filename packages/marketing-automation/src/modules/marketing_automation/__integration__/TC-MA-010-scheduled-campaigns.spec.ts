import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  CAMPAIGNS_PATH,
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  PALETTE_PATH,
  saveGraph,
} from './helpers/marketing'

const emailStep = { id: 's1', type: 'send_email', params: { subject: 'Hi', bodyHtml: '<p>Hi</p>' } }

/**
 * TC-MA-010: campaigns that run on a schedule.
 *
 * These are the campaigns with no event to react to — nothing HAPPENS to make a customer dormant, and
 * nothing happens when an order becomes old enough to review. Until the canvas could author a schedule
 * trigger they were API-only, so what this asserts is that the whole recipe now round-trips: the
 * palette offers the sources, the save accepts them, and a bad interval is refused at author time
 * rather than discovered by a worker that quietly does nothing.
 */
test.describe('TC-MA-010 scheduled campaigns', () => {
  test('the palette offers every sweep source with its label and default window', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    expect(response.ok()).toBe(true)
    const body = await readJsonSafe<{
      sweepSources?: Array<{ id?: string; labelKey?: string; available?: boolean; defaultWithinDays?: number | null }>
    }>(response)
    const sources = body?.sweepSources ?? []
    const ids = sources.map((source) => source.id)
    expect(ids).toEqual(expect.arrayContaining(['customers', 'expiring_quotes', 'fulfilled_orders']))
    for (const source of sources) {
      expect(source.labelKey, `${source.id} needs a label`).toMatch(/^marketing_automation\./)
    }
    // The population source has no window of its own; a row source offers a default so the form is
    // never blank.
    expect(sources.find((source) => source.id === 'customers')?.defaultWithinDays).toBeNull()
    expect(sources.find((source) => source.id === 'fulfilled_orders')?.defaultWithinDays).toBeGreaterThan(0)
  })

  // The win-back recipe, which needs no new code: a daily sweep over the population plus an audience
  // the database can narrow.
  test('a win-back campaign round-trips', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA win-back ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const trigger = {
        kind: 'schedule',
        scheduleValue: '1d',
        // Once ever: the audience stays true, so an unlimited policy would re-enrol every night.
        reentryAfterDays: null,
        sweepSource: 'customers',
        sweepParams: {},
      }
      const audience = {
        operator: 'AND',
        rules: [
          { field: 'orders.count', operator: '>=', value: 1 },
          { field: 'orders.daysSinceLast', operator: '>=', value: 90 },
        ],
      }

      const response = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA win-back',
        triggers: [trigger],
        definition: { version: 1, audience, steps: [emailStep] },
      })
      expect(response.ok(), await response.text()).toBe(true)

      const saved = await getCampaign(request, token, campaignId)
      expect(saved.triggers).toEqual([trigger])

      // And the audience half of it is answerable in the database, which is what keeps the nightly
      // sweep from projecting every customer in the organization.
      const estimate = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: { audience },
      })
      const body = await readJsonSafe<{ narrowing?: string; candidates?: number | null }>(estimate)
      expect(body?.narrowing).toContain('orders.daysSinceLast>=90')
      expect(body?.candidates).not.toBeNull()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a review-request campaign round-trips over the delivered-orders source', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA review request ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const trigger = {
        kind: 'schedule',
        scheduleValue: '6h',
        reentryAfterDays: null,
        sweepSource: 'fulfilled_orders',
        sweepParams: { withinDays: 5 },
      }

      const response = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA review request',
        triggers: [trigger],
        definition: {
          version: 1,
          audience: null,
          // The order the sweep found is in the context, so the message can name it.
          steps: [{ id: 's1', type: 'send_email', params: { subject: 'How was {{trigger.orderNumber}}?', bodyHtml: '<p>Tell us</p>' } }],
        },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const saved = await getCampaign(request, token, campaignId)
      expect(saved.triggers).toEqual([trigger])
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('two schedules over different sources are both kept', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA two schedules ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const triggers = [
        { kind: 'schedule', scheduleValue: '1d', reentryAfterDays: null, sweepSource: 'customers', sweepParams: {} },
        { kind: 'schedule', scheduleValue: '1d', reentryAfterDays: null, sweepSource: 'fulfilled_orders', sweepParams: { withinDays: 7 } },
      ]
      const response = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA two schedules',
        triggers,
        definition: { version: 1, audience: null, steps: [emailStep] },
      })
      expect(response.ok(), await response.text()).toBe(true)
      expect((await getCampaign(request, token, campaignId)).triggers).toHaveLength(2)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('refuses an unusable schedule at author time', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA bad schedule ${Date.now()}`)
      const { updatedAt } = await getCampaign(request, token, campaignId)

      const cases: Array<{ label: string; triggers: Array<Record<string, unknown>> }> = [
        {
          label: 'an interval with no unit',
          triggers: [{ kind: 'schedule', scheduleValue: '7', reentryAfterDays: null, sweepSource: 'customers', sweepParams: {} }],
        },
        {
          label: 'a made-up unit',
          triggers: [{ kind: 'schedule', scheduleValue: '3 fortnights', reentryAfterDays: null, sweepSource: 'customers', sweepParams: {} }],
        },
        {
          label: 'the same schedule twice',
          triggers: [
            { kind: 'schedule', scheduleValue: '1d', reentryAfterDays: null, sweepSource: 'customers', sweepParams: {} },
            { kind: 'schedule', scheduleValue: '1d', reentryAfterDays: null, sweepSource: 'customers', sweepParams: {} },
          ],
        },
        {
          label: 'a source this installation does not have',
          triggers: [{ kind: 'schedule', scheduleValue: '1d', reentryAfterDays: null, sweepSource: 'crystal_ball', sweepParams: {} }],
        },
      ]

      for (const { label, triggers } of cases) {
        const response = await saveGraph(request, token, campaignId, {
          updatedAt, name: 'x', triggers,
          definition: { version: 1, audience: null, steps: [emailStep] },
        })
        expect(response.status(), label).toBe(400)
      }

      // Nothing half-applied.
      const after = await getCampaign(request, token, campaignId)
      expect(after.triggers).toEqual([])
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
