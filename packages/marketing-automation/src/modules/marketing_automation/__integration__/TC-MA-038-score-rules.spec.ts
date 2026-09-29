import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const RULES_PATH = '/api/marketing_automation/score-rules'

type Rule = { id: string; name: string; points: number; isEnabled: boolean; updatedAt: string }
type Profile = {
  score: { points: number }
  recentScoreEntries: Array<{ points: number; source: string; reason: string | null }>
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
  await apiRequest(request, 'DELETE', `${RULES_PATH}/${rule.id}`, {
    token,
    headers: { 'x-om-ext-optimistic-lock-expected-updated-at': current.updatedAt },
  })
}

async function rescore(request: APIRequestContext, token: string, personId: string) {
  const response = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/rescore`, { token })
  expect(response.status(), 'rescore').toBe(200)
  return (await readJsonSafe<{ changed: boolean; delta: number; points: number }>(response))!
}

async function profile(request: APIRequestContext, token: string, personId: string): Promise<Profile> {
  const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${personId}/profile`, { token })
  expect(response.ok()).toBe(true)
  return (await readJsonSafe<Profile>(response)) as Profile
}

/**
 * TC-MA-038: score rules — points for who a customer is.
 *
 * The background pass cannot be drained from a test, so every assertion goes through the per-customer recalculate
 * endpoint and asserts the RESULTING state rather than which call wrote it: the person subscribers or the queued pass
 * may legitimately get there first, and the rule is only that the total is right and nothing is counted twice.
 */
test.describe('TC-MA-038 score rules', () => {
  test('a matching customer gets the points once, and loses them when the rule is switched off', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA Rule ${Date.now()}`
    let personId: string | null = null
    let rule: Rule | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Rule', displayName: marker })
      rule = await createRule(request, token, {
        name: `QA rule ${marker}`,
        points: 25,
        expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
      })

      const first = await rescore(request, token, personId)
      expect(first.points).toBe(25)

      const again = await rescore(request, token, personId)
      expect(again.changed, 'nothing changed, so nothing is written').toBe(false)
      expect(again.points).toBe(25)

      const scored = await profile(request, token, personId)
      expect(scored.score.points).toBe(25)
      const ruleEntries = scored.recentScoreEntries.filter((entry) => entry.source === 'rule')
      expect(ruleEntries.reduce((sum, entry) => sum + entry.points, 0)).toBe(25)
      expect(ruleEntries[0]?.reason).toContain(`QA rule ${marker}`)

      const off = await apiRequest(request, 'PUT', `${RULES_PATH}/${rule.id}`, {
        token,
        data: { isEnabled: false, updatedAt: rule.updatedAt },
      })
      expect(off.status()).toBe(200)
      rule = (await readJsonSafe<Rule>(off)) as Rule

      const after = await rescore(request, token, personId)
      expect(after.points).toBe(0)
      const cleared = await profile(request, token, personId)
      expect(cleared.recentScoreEntries.filter((entry) => entry.source === 'rule').reduce((sum, entry) => sum + entry.points, 0)).toBe(0)
    } finally {
      await removeRule(request, token, rule)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a customer the rule does not describe gets nothing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA Rule miss ${Date.now()}`
    let personId: string | null = null
    let rule: Rule | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Miss', displayName: marker })
      rule = await createRule(request, token, {
        name: `QA rule ${marker}`,
        points: 25,
        expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: `${marker} somebody else` }] },
      })
      const outcome = await rescore(request, token, personId)
      expect(outcome.points).toBe(0)
    } finally {
      await removeRule(request, token, rule)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('a rule may not read the score or segments, and points may not be zero', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    for (const expression of [
      { operator: 'AND', rules: [{ field: 'score.points', operator: '>=', value: 10 }] },
      { operator: 'AND', rules: [{ operator: 'OR', rules: [{ field: 'segments', operator: 'CONTAINS', value: 'vip' }] }] },
    ]) {
      const response = await apiRequest(request, 'POST', RULES_PATH, { token, data: { name: 'QA forbidden', points: 5, expression } })
      expect(response.status()).toBe(400)
      expect((await readJsonSafe<{ code?: string }>(response))?.code).toBe('marketing_automation.errors.scoreRuleSelfReference')
    }
    const zero = await apiRequest(request, 'POST', RULES_PATH, { token, data: { name: 'QA zero', points: 0, expression: null } })
    expect(zero.status()).toBe(400)
  })

  test('an edit against a stale version is refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let rule: Rule | null = null
    try {
      rule = await createRule(request, token, {
        name: `QA rule lock ${Date.now()}`,
        points: 5,
        isEnabled: false,
        expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: `nobody ${Date.now()}` }] },
      })
      const fresh = await apiRequest(request, 'PUT', `${RULES_PATH}/${rule.id}`, { token, data: { points: 6, updatedAt: rule.updatedAt } })
      expect(fresh.status()).toBe(200)
      const stale = await apiRequest(request, 'PUT', `${RULES_PATH}/${rule.id}`, { token, data: { points: 7, updatedAt: rule.updatedAt } })
      expect(stale.status()).toBe(409)
    } finally {
      await removeRule(request, token, rule)
    }
  })

  test('an anonymous caller is refused', async ({ request }) => {
    for (const response of [
      await request.get(RULES_PATH),
      await request.post(RULES_PATH, { data: { name: 'x', points: 1, expression: null } }),
      await request.post('/api/marketing_automation/customers/00000000-0000-4000-8000-000000000000/rescore'),
    ]) {
      expect([401, 403]).toContain(response.status())
    }
  })
})
