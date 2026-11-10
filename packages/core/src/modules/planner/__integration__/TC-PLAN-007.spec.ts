import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteEntityByPathIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type RuleItem = { id?: string; rrule?: string }

async function listRuleSetRules(request: APIRequestContext, token: string, ruleSetId: string): Promise<RuleItem[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/planner/availability?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}&pageSize=100`,
    { token },
  )
  expect(response.status(), 'GET /api/planner/availability should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: RuleItem[] }>(response)
  return body?.items ?? []
}

test.describe('TC-PLAN-007: availability replace rejects a window whose end is not after its start', () => {
  test('weekly and date-specific replace return 400 and keep the existing hours', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    let ruleSetId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/planner/availability-rule-sets', {
        token,
        data: { name: `QA inverted window ${Date.now()}`, timezone: 'UTC' },
      })
      expect(createResponse.status(), 'POST /api/planner/availability-rule-sets should return 201').toBe(201)
      ruleSetId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'Rule set id')

      const weeklyBase = { subjectType: 'ruleset', subjectId: ruleSetId, timezone: 'UTC' }
      const weeklyOk = await apiRequest(request, 'POST', '/api/planner/availability-weekly', {
        token,
        data: { ...weeklyBase, windows: [{ weekday: 1, start: '09:00', end: '10:00' }] },
      })
      expect(weeklyOk.status(), 'Valid weekly replace should return 200').toBe(200)

      const dateOk = await apiRequest(request, 'POST', '/api/planner/availability-date-specific', {
        token,
        data: { ...weeklyBase, dates: [date], kind: 'availability', windows: [{ start: '08:00', end: '12:00' }] },
      })
      expect(dateOk.status(), 'Valid date-specific replace should return 200').toBe(200)

      const before = await listRuleSetRules(request, token, ruleSetId)
      expect(before, 'One weekly and one date-specific rule should exist').toHaveLength(2)

      for (const window of [{ start: '09:00', end: '09:00' }, { start: '17:00', end: '09:00' }]) {
        const weeklyBad = await apiRequest(request, 'POST', '/api/planner/availability-weekly', {
          token,
          data: { ...weeklyBase, windows: [{ weekday: 1, ...window }] },
        })
        expect(weeklyBad.status(), `Weekly ${window.start}-${window.end} should return 400`).toBe(400)
        const weeklyBody = await readJsonSafe<{ ok?: boolean; error?: string }>(weeklyBad)
        expect(weeklyBody?.ok).toBeUndefined()
        expect(typeof weeklyBody?.error).toBe('string')

        const dateBad = await apiRequest(request, 'POST', '/api/planner/availability-date-specific', {
          token,
          data: { ...weeklyBase, dates: [date], kind: 'availability', windows: [window] },
        })
        expect(dateBad.status(), `Date-specific ${window.start}-${window.end} should return 400`).toBe(400)
      }

      const after = await listRuleSetRules(request, token, ruleSetId)
      expect(after.map((rule) => rule.id).sort(), 'Rejected requests must not delete existing rules').toEqual(
        before.map((rule) => rule.id).sort(),
      )

      const dayOff = await apiRequest(request, 'POST', '/api/planner/availability-date-specific', {
        token,
        data: { ...weeklyBase, dates: [date], kind: 'unavailability', windows: [{ start: '17:00', end: '09:00' }] },
      })
      expect(dayOff.status(), 'Unavailability ignores its windows and should still return 200').toBe(200)
    } finally {
      if (ruleSetId) {
        const leftovers = await listRuleSetRules(request, token, ruleSetId).catch(() => [] as RuleItem[])
        for (const rule of leftovers) {
          if (rule.id) await deleteEntityByPathIfExists(request, token, `/api/planner/availability?id=${encodeURIComponent(rule.id)}`)
        }
        await deleteEntityByPathIfExists(request, token, `/api/planner/availability-rule-sets?id=${encodeURIComponent(ruleSetId)}`)
      }
    }
  })
})
