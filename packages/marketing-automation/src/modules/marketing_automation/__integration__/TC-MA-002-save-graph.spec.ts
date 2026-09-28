import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  minimalGraph,
  saveGraph,
} from './helpers/marketing'

/**
 * TC-MA-002: the save-graph contract.
 *
 * Three properties the canvas cannot work without: the authored graph round-trips unchanged
 * (including canvas positions, which is why layout lives inside the definition), a stale save
 * collides instead of overwriting, and an ungrunnable graph is refused at author time rather
 * than accepted and silently doing nothing at runtime.
 */
test.describe('TC-MA-002 save graph', () => {
  test('round-trips triggers, step order, audience and canvas layout', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null

    try {
      campaignId = await createCampaign(request, token, `QA graph ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)

      const audience = {
        operator: 'AND',
        rules: [{ field: 'trigger.orderTotal', operator: '>=', value: 100 }],
      }
      const response = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA graph saved',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience,
          steps: [
            { id: 's1', type: 'add_tag', params: { tagId: '11111111-1111-4111-8111-111111111111' } /* RFC-valid variant nibble: z.string().uuid() is strict */ },
            { id: 'w1', type: 'wait', params: { minutes: 30 } },
            { id: 's2', type: 'send_email', params: { subject: 'Hi', bodyHtml: '<p>Hi</p>' } },
          ],
          canvas: { nodePositions: { audience: { x: 320, y: 40 } } },
        },
      })
      expect(response.ok()).toBe(true)

      const saved = await getCampaign(request, token, campaignId)
      expect(saved.name).toBe('QA graph saved')
      // Saving a graph never publishes: enabling is a separate, separately-gated endpoint.
      expect(saved.isEnabled).toBe(false)
      expect(saved.triggers).toEqual([{ kind: 'event', eventId: 'sales.order.created' }])
      expect(saved.definition.steps.map((step) => [step.id, step.type])).toEqual([
        ['s1', 'add_tag'],
        ['w1', 'wait'],
        ['s2', 'send_email'],
      ])
      expect(saved.definition.audience).toEqual(audience)
      expect(saved.definition.canvas?.nodePositions?.audience).toEqual({ x: 320, y: 40 })
      expect(saved.updatedAt).not.toBe(created.updatedAt)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('answers 409 with the current version when the save is stale', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null

    try {
      campaignId = await createCampaign(request, token, `QA conflict ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const graph = minimalGraph(created.updatedAt, 'QA conflict')

      const first = await saveGraph(request, token, campaignId, graph)
      expect(first.ok()).toBe(true)

      // Same payload again — its `updatedAt` is now one version behind.
      const stale = await saveGraph(request, token, campaignId, graph)
      expect(stale.status()).toBe(409)
      // The canonical platform conflict body, so the shared conflict bar renders it.
      const body = await readJsonSafe<{ code?: string; currentUpdatedAt?: string; expectedUpdatedAt?: string }>(stale)
      expect(body?.code).toBe('optimistic_lock_conflict')
      expect(body?.currentUpdatedAt, 'the conflict carries the current version so the UI can recover').toBeTruthy()
      expect(body?.currentUpdatedAt).not.toBe(graph.updatedAt)
      expect(body?.expectedUpdatedAt).toBe(graph.updatedAt)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('refuses graphs this installation cannot run', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null

    try {
      campaignId = await createCampaign(request, token, `QA validation ${Date.now()}`)
      const { updatedAt } = await getCampaign(request, token, campaignId)
      const trigger = { kind: 'event', eventId: 'sales.order.created' }
      const emailStep = { id: 's1', type: 'send_email', params: { subject: 'x', bodyHtml: '<p>x</p>' } }

      const cases: Array<{ label: string; graph: Parameters<typeof saveGraph>[3] }> = [
        {
          label: 'a trailing wait has nothing to wait for',
          graph: {
            updatedAt, name: 'x', triggers: [trigger],
            definition: { version: 1, audience: null, steps: [emailStep, { id: 'w', type: 'wait', params: { minutes: 5 } }] },
          },
        },
        {
          label: 'an unknown step type',
          graph: {
            updatedAt, name: 'x', triggers: [trigger],
            definition: { version: 1, audience: null, steps: [{ id: 's', type: 'send_pigeon', params: {} }] },
          },
        },
        {
          label: 'a duplicate trigger',
          graph: {
            updatedAt, name: 'x', triggers: [trigger, trigger],
            definition: { version: 1, audience: null, steps: [emailStep] },
          },
        },
        {
          label: 'a trigger that is not available here',
          graph: {
            updatedAt, name: 'x', triggers: [{ kind: 'event', eventId: 'storefront.cart.abandoned' }],
            definition: { version: 1, audience: null, steps: [emailStep] },
          },
        },
        {
          label: 'invalid step parameters',
          graph: {
            updatedAt, name: 'x', triggers: [trigger],
            definition: { version: 1, audience: null, steps: [{ id: 'w', type: 'wait', params: { minutes: -5 } }, emailStep] },
          },
        },
      ]

      for (const { label, graph } of cases) {
        const response = await saveGraph(request, token, campaignId, graph)
        expect(response.status(), label).toBe(400)
        // A stable code, not just a status: it is what the editor turns into a localized message.
        const body = await readJsonSafe<{ code?: string }>(response)
        expect(body?.code, `${label} carries a validation code`).toMatch(/^marketing_automation\.validation\./)
      }

      // Every rejection left the campaign untouched, so a bad save cannot half-apply.
      const after = await getCampaign(request, token, campaignId)
      expect(after.definition.steps).toEqual([])
      expect(after.triggers).toEqual([])
      expect(after.updatedAt).toBe(updatedAt)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
