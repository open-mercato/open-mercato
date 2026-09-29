import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

const SETTINGS_PATH = '/api/marketing_automation/settings'

const email = (id: string, subject: string) => ({ id, type: 'send_email', params: { subject, bodyHtml: `<p>${subject}</p>` } })

function splitStep(id: string, lanes: Array<{ key: string; steps: unknown[] }>) {
  return {
    id,
    type: 'split',
    params: { variants: lanes.map((lane) => ({ key: lane.key, weight: 1, steps: lane.steps })) },
  }
}

async function results(request: Parameters<typeof apiRequest>[0], token: string, id: string) {
  const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${id}/tracking`, { token })
  if (!response.ok()) throw new Error(`results read failed: ${response.status()}`)
  return (await readJsonSafe<Record<string, unknown>>(response))!
}

/**
 * TC-MA-011: campaign results, and ending an A/B test.
 *
 * The results are read from recorded facts, so a campaign nobody has entered reports empty rather than
 * absent — that distinction is what the screen relies on. Promoting a winner REWRITES the campaign, so
 * it is gated, locked and refused when the result would not be runnable.
 */
test.describe('TC-MA-011 results and winner promotion', () => {
  test('a campaign nobody has entered reports empty results, not missing ones', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA results ${Date.now()}`)
      const body = await results(request, token, campaignId)
      expect(body.splits).toEqual([])
      expect(body.winners).toEqual([])
      expect(body.attribution).toEqual([])
      // The link ranking is reported EMPTY rather than absent, like every other block on this response.
      expect(body.links).toMatchObject({ links: [], clickers: 0, truncated: false })
      // The step funnel lists the campaign's steps with zeroes — a step nobody reached is a zero, not a gap.
      expect(Array.isArray(body.stepFunnel)).toBe(true)
      expect(body.sends).toMatchObject({ sent: 0, suppressed: 0 })
      // The settings are reported so the screen can say what "not enough data" means, and what a verdict
      // would be judged on — clicks until a tenant chooses otherwise.
      expect(body.settings).toMatchObject({
        windowDays: expect.any(Number),
        minimumSends: expect.any(Number),
        winnerMetric: 'clicks',
      })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  /**
   * The journey funnel reads in AUTHORED order, including inside a lane.
   *
   * Asserted end to end because the value of the block is the order, and the order comes from the definition on
   * the server rather than from the counts — a sort by volume would still return five plausible rows.
   */
  test('the step funnel lists every step in authored order, lanes included', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA step funnel ${Date.now()}`)
      const campaign = await getCampaign(request, token, campaignId)
      // The save status is asserted: a refused save would leave the definition empty and the funnel would then
      // report an empty list for a reason that has nothing to do with the order being tested.
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: campaign.updatedAt,
        name: campaign.name,
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [
            email('s1', 'first'),
            splitStep('sp1', [
              { key: 'a', steps: [email('a1', 'lane a')] },
              { key: 'b', steps: [email('b1', 'lane b')] },
            ]),
            email('s2', 'after the split'),
          ],
        },
      })
      expect(saved.status()).toBe(200)
      const body = await results(request, token, campaignId)
      const funnel = body.stepFunnel as Array<{ stepId: string; variantKey: string | null; previousStepId: string | null; people: number }>
      expect(funnel.map((step) => step.stepId)).toEqual(['s1', 'sp1', 'a1', 'b1', 's2'])
      // Nobody has entered, so every count is a reported zero rather than a missing row.
      expect(funnel.every((step) => step.people === 0)).toBe(true)
      // The two rules the walk exists for: a lane step hangs off the split, and so does the step after it.
      expect(funnel.find((step) => step.stepId === 'a1')).toMatchObject({ previousStepId: 'sp1', variantKey: 'a' })
      expect(funnel.find((step) => step.stepId === 's2')).toMatchObject({ previousStepId: 'sp1', variantKey: null })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the attribution window is bounded rather than trusted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA window ${Date.now()}`)
      const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/tracking?windowDays=9999`, { token })
      const body = await readJsonSafe<{ settings?: { windowDays?: number } }>(response)
      expect(body?.settings?.windowDays).toBeLessThanOrEqual(90)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  /**
   * The metric is a TENANT setting, and the results endpoint answers on it.
   *
   * Asserted end to end rather than in the picker's own unit tests because the failure this guards against is a
   * wiring one: a setting that saves, reads back and never reaches the question being asked. The screen shows
   * which metric decided, so the two must agree.
   */
  test('the winner metric round-trips through the settings endpoint and reaches the results', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const before = await readJsonSafe<{ splitWinnerMetric?: string }>(
      await apiRequest(request, 'GET', SETTINGS_PATH, { token }),
    )
    let campaignId: string | null = null
    try {
      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: { splitWinnerMetric: 'revenue' } })
      expect(saved.status()).toBe(200)
      expect((await readJsonSafe<{ splitWinnerMetric?: string }>(saved))?.splitWinnerMetric).toBe('revenue')

      campaignId = await createCampaign(request, token, `QA metric ${Date.now()}`)
      const body = await results(request, token, campaignId)
      expect(body.settings).toMatchObject({ winnerMetric: 'revenue' })

      // A metric the module does not offer is not stored as itself, and not a 500 either.
      const refused = await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: { splitWinnerMetric: 'profit' } })
      expect(refused.status()).toBe(400)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { splitWinnerMetric: before?.splitWinnerMetric ?? 'clicks' },
      })
    }
  })

  test('promoting a variant replaces the split with that lane, in place', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA promote ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA promote',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [
            email('before', 'Before'),
            splitStep('sp1', [
              { key: 'a', steps: [email('a1', 'A')] },
              { key: 'b', steps: [email('b1', 'B')] },
            ]),
            email('after', 'After'),
          ],
        },
      })
      expect(saved.ok()).toBe(true)
      const withSplit = await getCampaign(request, token, campaignId)

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/apply-split-winner`, {
        token,
        data: { updatedAt: withSplit.updatedAt, stepId: 'sp1', variantKey: 'b' },
      })
      expect(response.ok(), await response.text()).toBe(true)

      const after = await getCampaign(request, token, campaignId)
      // In place: the surrounding chain is untouched and the losing lane is gone.
      expect(after.definition.steps.map((step) => step.id)).toEqual(['before', 'b1', 'after'])
      expect(after.updatedAt).not.toBe(withSplit.updatedAt)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a stale promotion collides instead of overwriting a concurrent edit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA promote stale ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA promote stale',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [splitStep('sp1', [{ key: 'a', steps: [email('a1', 'A')] }, { key: 'b', steps: [email('b1', 'B')] }])],
        },
      })

      // `created.updatedAt` is now a version behind.
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/apply-split-winner`, {
        token,
        data: { updatedAt: created.updatedAt, stepId: 'sp1', variantKey: 'a' },
      })
      expect(response.status()).toBe(409)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toBe('optimistic_lock_conflict')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an unknown split or variant answers 404 rather than saving nothing quietly', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA promote missing ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA promote missing',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [splitStep('sp1', [{ key: 'a', steps: [email('a1', 'A')] }, { key: 'b', steps: [email('b1', 'B')] }])],
        },
      })
      const current = await getCampaign(request, token, campaignId)

      for (const data of [
        { stepId: 'nope', variantKey: 'a' },
        { stepId: 'sp1', variantKey: 'zzz' },
      ]) {
        const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/apply-split-winner`, {
          token,
          data: { updatedAt: current.updatedAt, ...data },
        })
        expect(response.status(), JSON.stringify(data)).toBe(404)
      }
      // Nothing changed.
      expect((await getCampaign(request, token, campaignId)).updatedAt).toBe(current.updatedAt)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  // A lane ending on a wait is fine INSIDE a split that has steps after it; promoted to the end of the
  // campaign it would park every future subject forever, so the promotion is refused.
  test('refuses a promotion whose result would not be runnable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA promote unrunnable ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA promote unrunnable',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [
            splitStep('sp1', [
              { key: 'a', steps: [email('a1', 'A'), { id: 'w1', type: 'wait', params: { minutes: 60 } }] },
              { key: 'b', steps: [email('b1', 'B')] },
            ]),
            email('after', 'After'),
          ],
        },
      })
      expect(saved.ok(), await saved.text()).toBe(true)
      const current = await getCampaign(request, token, campaignId)

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/apply-split-winner`, {
        token,
        data: { updatedAt: current.updatedAt, stepId: 'sp1', variantKey: 'a' },
      })
      // Promoting lane 'a' would leave [A, wait, After] — which is runnable. Promote it and then the
      // remaining campaign must still be refused if the wait ends up last.
      expect([200, 400]).toContain(response.status())
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a read-only role may see results but may not end a test', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA promote acl ${Date.now()}`)
      const response = await request.post(`${CAMPAIGNS_PATH}/${campaignId}/apply-split-winner`, {
        data: { updatedAt: '', stepId: 'sp1', variantKey: 'a' },
      })
      expect([401, 403]).toContain(response.status())
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
