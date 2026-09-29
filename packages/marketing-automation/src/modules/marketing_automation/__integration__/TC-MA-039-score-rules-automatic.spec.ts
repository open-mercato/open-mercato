import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  listRuns,
  saveGraph,
  setEnabled,
} from './helpers/marketing'

const RULES_PATH = '/api/marketing_automation/score-rules'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

/** Long enough for a queue worker to pick up a persistent event and a queued pass; the module's other specs wait 20s. */
const SETTLE = { timeout: 30_000, intervals: [500, 1000, 2000] }

type Rule = { id: string; updatedAt: string }
type Profile = {
  score: { points: number; tier: string | null; tierRank: number }
  recentScoreEntries: Array<{ points: number; source: string }>
}

async function createRule(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<Rule> {
  const response = await apiRequest(request, 'POST', RULES_PATH, { token, data })
  expect(response.status(), 'rule create').toBe(200)
  return (await readJsonSafe<Rule>(response)) as Rule
}

async function removeRule(request: APIRequestContext, token: string, rule: Rule | null): Promise<void> {
  if (!rule) return
  const read = await apiRequest(request, 'GET', `${RULES_PATH}/${rule.id}`, { token })
  if (!read.ok()) return
  const current = (await readJsonSafe<Rule>(read)) as Rule
  await apiRequest(request, 'DELETE', `${RULES_PATH}/${rule.id}`, { token, headers: { [LOCK_HEADER]: current.updatedAt } })
}

async function readProfile(request: APIRequestContext, token: string, personId: string): Promise<Profile> {
  const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${personId}/profile`, { token })
  expect(response.ok()).toBe(true)
  return (await readJsonSafe<Profile>(response)) as Profile
}

async function scoreOf(request: APIRequestContext, token: string, personId: string): Promise<number> {
  return (await readProfile(request, token, personId)).score.points
}

async function createTag(request: APIRequestContext, token: string, label: string): Promise<string> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const response = await apiRequest(request, 'POST', '/api/customers/tags', { token, data: { label, slug } })
  expect(response.status(), 'tag create').toBeLessThan(400)
  return ((await readJsonSafe<{ id?: string }>(response))?.id) as string
}

function byName(marker: string) {
  return { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] }
}

/**
 * TC-MA-039: score rules applied without anybody pressing "recalculate".
 *
 * Every path here is asynchronous — a persistent subscriber, or the queued pass — so each assertion polls the
 * profile until the worker has done its job, as TC-MA-020 does for runs. Each test owns its customer, rule, tag
 * and campaign, and removes them in `finally`.
 */
test.describe('TC-MA-039 score rules, applied automatically', () => {
  test('assigning a tag the rule looks for awards the points, with no recalculate call', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    let tagId: string | null = null
    let rule: Rule | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Tag', displayName: `QA Tag ${stamp}` })
      tagId = await createTag(request, token, `qa-rule-tag-${stamp}`)
      rule = await createRule(request, token, {
        name: `QA tag rule ${stamp}`,
        points: 30,
        expression: { operator: 'AND', rules: [{ field: 'tags', operator: 'CONTAINS', value: `qa-rule-tag-${stamp}` }] },
      })
      expect(await scoreOf(request, token, personId)).toBe(0)

      const assigned = await apiRequest(request, 'POST', '/api/customers/tags/assign', { token, data: { tagId, entityId: personId } })
      expect(assigned.status()).toBeLessThan(400)

      await expect.poll(() => scoreOf(request, token, personId!), SETTLE).toBe(30)

      const unassigned = await apiRequest(request, 'POST', '/api/customers/tags/unassign', { token, data: { tagId, entityId: personId } })
      expect(unassigned.status()).toBeLessThan(400)

      await expect.poll(() => scoreOf(request, token, personId!), SETTLE).toBe(0)
    } finally {
      await removeRule(request, token, rule)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
    }
  })

  test('creating a rule reaches existing customers, and removing it takes the points back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA Pass ${Date.now()}`
    let personId: string | null = null
    let rule: Rule | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Pass', displayName: marker })
      rule = await createRule(request, token, { name: `QA pass rule ${marker}`, points: 40, expression: byName(marker) })

      // Nobody touches the customer: only the pass queued by the create can award these.
      await expect.poll(() => scoreOf(request, token, personId!), SETTLE).toBe(40)

      await removeRule(request, token, rule)
      rule = null

      await expect.poll(() => scoreOf(request, token, personId!), SETTLE).toBe(0)
      const entries = (await readProfile(request, token, personId)).recentScoreEntries.filter((entry) => entry.source === 'rule')
      expect(entries.map((entry) => entry.points).sort((a, b) => a - b)).toEqual([-40, 40])
    } finally {
      await removeRule(request, token, rule)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a deduction and an award net out, and the tier follows the total', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA Net ${Date.now()}`
    let personId: string | null = null
    const rules: Array<Rule | null> = []
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Net', displayName: marker })
      const before = (await readProfile(request, token, personId)).score
      rules.push(await createRule(request, token, { name: `QA award ${marker}`, points: 600, expression: byName(marker) }))
      rules.push(await createRule(request, token, { name: `QA deduct ${marker}`, points: -50, expression: byName(marker) }))

      const rescored = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/rescore`, { token })
      expect(rescored.status()).toBe(200)

      await expect.poll(() => scoreOf(request, token, personId!), SETTLE).toBe(550)
      // The tier is derived from the total, whatever awarded it: 550 is past the default 100 and 500 bounds, so the
      // customer climbs the ladder without anything but rules having touched them.
      const after = (await readProfile(request, token, personId)).score
      expect(after.tierRank).toBeGreaterThan(before.tierRank)
    } finally {
      for (const rule of rules) await removeRule(request, token, rule)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('crossing a threshold by rule starts a campaign listening for score changes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA Threshold ${stamp}`
    let personId: string | null = null
    let tagId: string | null = null
    let rule: Rule | null = null
    let campaignId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Threshold', displayName: marker })
      tagId = await createTag(request, token, `qa-threshold-${stamp}`)

      campaignId = await createCampaign(request, token, `TC-MA-039 threshold ${stamp}`)
      const detail = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: detail.updatedAt,
        name: detail.name,
        triggers: [{ kind: 'event', eventId: 'marketing_automation.customer.score_changed' }],
        definition: {
          version: 1,
          // "Reached 100", not "is above 100" — and only this test's customer, so no other spec's points start it.
          audience: {
            operator: 'AND',
            rules: [
              { field: 'customer.displayName', operator: '=', value: marker },
              { field: 'trigger.previousPoints', operator: '<', value: 100 },
              { field: 'score.points', operator: '>=', value: 100 },
            ],
          },
          // A tag rather than a send, so the run does not depend on an email channel in this environment.
          steps: [{ id: 'step-tag', type: 'add_tag', params: { tagId } }],
        },
      })
      expect(saved.status()).toBe(200)
      const afterSave = await getCampaign(request, token, campaignId)
      expect((await setEnabled(request, token, campaignId, { updatedAt: afterSave.updatedAt, isEnabled: true })).status()).toBe(200)

      rule = await createRule(request, token, { name: `QA threshold rule ${marker}`, points: 150, expression: byName(marker) })
      const rescored = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/rescore`, { token })
      expect(rescored.status()).toBe(200)

      await expect.poll(async () => {
        const body = await readJsonSafe<{ items?: Array<{ subjectEntityId?: string | null }> }>(await listRuns(request, token, campaignId!))
        return (body?.items ?? []).filter((run) => run.subjectEntityId === personId).length
      }, SETTLE).toBe(1)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await removeRule(request, token, rule)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
    }
  })

  test('an erased person is never scored again, not even by the pass a rule change queues', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA Erased ${Date.now()}`
    let personId: string | null = null
    let rule: Rule | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Erased', displayName: marker })
      rule = await createRule(request, token, { name: `QA erased rule ${marker}`, points: 20, expression: byName(marker) })
      const first = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/rescore`, { token })
      expect(first.status()).toBe(200)
      await expect.poll(() => scoreOf(request, token, personId!), SETTLE).toBe(20)

      const erased = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/gdpr`, {
        token,
        data: { confirm: 'erase' },
      })
      expect(erased.status()).toBe(200)
      expect(await scoreOf(request, token, personId)).toBe(0)

      const refused = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/rescore`, { token })
      expect(refused.status()).toBe(409)
      expect((await readJsonSafe<{ code?: string }>(refused))?.code).toBe('marketing_automation.errors.subjectErased')

      // A rule edit queues a pass over everybody. It must walk past this person rather than start a new ledger.
      const edited = await apiRequest(request, 'PUT', `${RULES_PATH}/${rule.id}`, { token, data: { points: 21, updatedAt: rule.updatedAt } })
      expect(edited.status()).toBe(200)
      rule = (await readJsonSafe<Rule>(edited)) as Rule
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      expect(await scoreOf(request, token, personId)).toBe(0)
    } finally {
      await removeRule(request, token, rule)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a company is not scored, and an unknown id is not found', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(request, token, `QA Rule Company ${Date.now()}`)
      const company = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${companyId}/rescore`, { token })
      expect(company.status()).toBe(404)
      const unknown = await apiRequest(request, 'POST', '/api/marketing_automation/customers/00000000-0000-4000-8000-000000000000/rescore', { token })
      expect(unknown.status()).toBe(404)
      const malformed = await apiRequest(request, 'POST', '/api/marketing_automation/customers/not-a-uuid/rescore', { token })
      expect(malformed.status()).toBe(400)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('a user who may only view campaigns can read the rules and change nothing', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const roleName = `qa_ma_rules_view_${stamp}`
    const email = `qa-ma-rules-view-${stamp}@acme.com`
    const password = 'Valid1!Pass'
    let roleId: string | null = null
    let userId: string | null = null
    let personId: string | null = null
    try {
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      const acl = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: { roleId, features: ['marketing_automation.campaigns.view'] },
      })
      expect(acl.ok()).toBe(true)
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA MA rules viewer',
      })
      personId = await createPersonFixture(request, adminToken, { firstName: 'QA', lastName: 'Viewer', displayName: `QA Viewer ${stamp}` })
      const viewerToken = await getAuthToken(request, email, password)

      expect((await apiRequest(request, 'GET', RULES_PATH, { token: viewerToken })).status()).toBe(200)
      const create = await apiRequest(request, 'POST', RULES_PATH, { token: viewerToken, data: { name: 'QA nope', points: 1, expression: null } })
      expect(create.status()).toBe(403)
      const rescore = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/rescore`, { token: viewerToken })
      expect(rescore.status()).toBe(403)
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
