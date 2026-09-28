import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  CAMPAIGNS_PATH,
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  listRuns,
  saveGraph,
  setEnabled,
} from './helpers/marketing'
import { resolveTrackingSecret, trackingSecretEnvNames } from '../lib/tracking/secret'
import { INBOUND_PATH, INBOUND_TOKEN_PARAM, signInboundToken } from '../lib/inbound'

const HOOKS_PATH = '/api/marketing_automation/inbound-hooks'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type HookBody = { id?: string; url?: string | null; name?: string; revokedAt?: string | null; updatedAt?: string; receivedCount?: number; lastOutcome?: string | null }

function readTrackingSecret(): string | null {
  const fromEnv = resolveTrackingSecret()
  if (fromEnv) return fromEnv
  const envFile = path.resolve(process.cwd(), 'apps/mercato/.env')
  if (!fs.existsSync(envFile)) return null
  const values: Record<string, string> = {}
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  for (const name of trackingSecretEnvNames()) {
    const value = values[name]?.trim()
    if (value) return value
  }
  return null
}

const secret = readTrackingSecret()

/**
 * TC-MA-020: inbound hooks.
 *
 * The assertions worth having are about what the PUBLIC endpoint refuses and what it declines to reveal: a
 * forged token, a revoked hook, an oversized body — and, whatever happened, the same answer to every caller.
 */
test.describe('TC-MA-020 inbound hooks', () => {
  test('a hook is created with a usable URL, receives a post, and can be revoked', async ({ request }) => {
    test.skip(!secret, 'no signing secret configured in this environment')
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-020 ${Date.now()}`)
    let hook: HookBody | null = null

    try {
      const created = await apiRequest(request, 'POST', HOOKS_PATH, {
        token,
        data: { campaignId, name: 'Warehouse system' },
      })
      expect(created.status()).toBe(200)
      hook = await readJsonSafe<HookBody>(created)
      expect(hook?.id).toBeTruthy()
      expect(hook?.url).toContain(`${INBOUND_PATH}?${INBOUND_TOKEN_PARAM}=`)

      // The URL is DERIVED, so reading the list again yields the same one rather than a new secret.
      const listed = await apiRequest(request, 'GET', `${HOOKS_PATH}?campaignId=${campaignId}`, { token })
      const list = await readJsonSafe<{ items?: HookBody[] }>(listed)
      expect(list?.items?.[0]?.url).toBe(hook?.url)

      // A post with no identity is still accepted — the endpoint records why nothing happened.
      const posted = await request.post(hook!.url as string, { data: { orderRef: 'A-9' } })
      expect(posted.status()).toBe(202)
      expect(await readJsonSafe<{ accepted?: boolean }>(posted)).toEqual({ accepted: true })

      const afterPost = await apiRequest(request, 'GET', `${HOOKS_PATH}?campaignId=${campaignId}`, { token })
      const activity = await readJsonSafe<{ items?: HookBody[] }>(afterPost)
      expect(activity?.items?.[0]?.receivedCount).toBe(1)
      // The outcome is visible HERE and nowhere else, which is the point of the 202.
      expect(activity?.items?.[0]?.lastOutcome).toContain('no customerId')

      const current = activity?.items?.[0] as HookBody
      const revoked = await apiRequest(request, 'PUT', `${HOOKS_PATH}/${hook!.id}`, {
        token,
        headers: { [LOCK_HEADER]: current.updatedAt! },
        data: { updatedAt: current.updatedAt, revoked: true },
      })
      expect(revoked.status()).toBe(200)

      // A revoked hook answers like one that never existed.
      const afterRevoke = await request.post(hook!.url as string, { data: { orderRef: 'A-9' } })
      expect(afterRevoke.status()).toBe(400)
    } finally {
      if (hook?.id) {
        const current = await apiRequest(request, 'GET', `${HOOKS_PATH}?campaignId=${campaignId}`, { token })
        const body = await readJsonSafe<{ items?: HookBody[] }>(current)
        const row = body?.items?.find((item) => item.id === hook?.id)
        if (row?.updatedAt) {
          await apiRequest(request, 'DELETE', `${HOOKS_PATH}/${hook.id}`, {
            token,
            headers: { [LOCK_HEADER]: row.updatedAt },
          })
        }
      }
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a forged token is refused', async ({ request }) => {
    test.skip(!secret, 'no signing secret configured in this environment')
    const forged = signInboundToken(
      { tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002', hookId: '00000000-0000-0000-0000-000000000003' },
      'not-the-real-secret',
    )
    const response = await request.post(`${INBOUND_PATH}?${INBOUND_TOKEN_PARAM}=${forged}`, { data: {} })
    expect(response.status()).toBe(400)
  })

  test('a token that verifies but names no hook is refused', async ({ request }) => {
    test.skip(!secret, 'no signing secret configured in this environment')
    const wellSigned = signInboundToken(
      { tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002', hookId: '00000000-0000-0000-0000-000000000003' },
      secret as string,
    )
    const response = await request.post(`${INBOUND_PATH}?${INBOUND_TOKEN_PARAM}=${wellSigned}`, { data: {} })
    expect(response.status()).toBe(400)
  })

  test('a missing token is refused', async ({ request }) => {
    const response = await request.post(INBOUND_PATH, { data: {} })
    expect(response.status()).toBe(400)
  })

  test('the palette offers the trigger', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token })
    const body = await readJsonSafe<{ triggers?: Array<{ eventId?: string; available?: boolean; contextKeys?: string[] }> }>(response)
    const trigger = (body?.triggers ?? []).find((entry) => entry.eventId === 'marketing_automation.inbound.received')
    expect(trigger?.available).toBe(true)
    expect(trigger?.contextKeys).toContain('trigger.hookName')
  })

  test('a hook cannot be created for a campaign that does not exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', HOOKS_PATH, {
      token,
      data: { campaignId: '00000000-0000-0000-0000-000000000000', name: 'Nowhere' },
    })
    expect(response.status()).toBe(404)
  })

  test('an anonymous caller cannot list the hooks', async ({ request }) => {
    const response = await request.get(HOOKS_PATH)
    expect([401, 403]).toContain(response.status())
  })

  test('a post naming a customer starts a real run', async ({ request }) => {
    test.skip(!secret, 'no signing secret configured in this environment')
    const token = await getAuthToken(request, 'admin')

    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(
      await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token }),
    )
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const campaignId = await createCampaign(request, token, `TC-MA-020 live ${Date.now()}`)
    let hookId: string | null = null

    try {
      const detail = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: detail.updatedAt,
        name: detail.name,
        triggers: [{ kind: 'event', eventId: 'marketing_automation.inbound.received' }],
        definition: {
          version: 1,
          audience: null,
          // Points rather than a send: this test is about whether the run STARTS, and a send would
          // depend on an email channel being configured in the environment running the suite.
          steps: [{ id: 'step-points', type: 'add_points', params: { points: 1, reason: 'TC-MA-020' } }],
        },
      })
      expect(saved.status()).toBe(200)

      const afterSave = await getCampaign(request, token, campaignId)
      const enabled = await setEnabled(request, token, campaignId, { updatedAt: afterSave.updatedAt, isEnabled: true })
      expect(enabled.status()).toBe(200)

      const created = await apiRequest(request, 'POST', HOOKS_PATH, { token, data: { campaignId, name: 'Live hook' } })
      const hook = await readJsonSafe<HookBody>(created)
      hookId = hook?.id ?? null
      expect(hook?.url).toBeTruthy()

      const posted = await request.post(hook!.url as string, { data: { customerId, orderRef: 'A-9' } })
      expect(posted.status()).toBe(202)

      // The subscriber is persistent, so the run appears once the queue worker has picked the event up.
      let runs: Array<{ triggerEventId?: string }> = []
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const body = await readJsonSafe<{ items?: Array<{ triggerEventId?: string }> }>(
          await listRuns(request, token, campaignId),
        )
        runs = body?.items ?? []
        if (runs.length > 0) break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      expect(runs.length, 'the hook should have started a run').toBeGreaterThan(0)
      expect(runs[0].triggerEventId).toBe('marketing_automation.inbound.received')
    } finally {
      if (hookId) {
        const body = await readJsonSafe<{ items?: HookBody[] }>(
          await apiRequest(request, 'GET', `${HOOKS_PATH}?campaignId=${campaignId}`, { token }),
        )
        const row = body?.items?.find((item) => item.id === hookId)
        if (row?.updatedAt) {
          await apiRequest(request, 'DELETE', `${HOOKS_PATH}/${hookId}`, { token, headers: { [LOCK_HEADER]: row.updatedAt } })
        }
      }
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the campaigns endpoint is unaffected by the new trigger', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}?pageSize=1`, { token })
    expect(response.status()).toBe(200)
  })
})
