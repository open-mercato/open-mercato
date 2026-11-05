import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createAvailabilityRuleSetFixture,
  deleteAvailabilityRuleSetIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/plannerFixtures'
import { createStaffTeamMemberFixture, deleteStaffEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/staffFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchRuleSetUpdatedAt(
  request: APIRequestContext,
  token: string,
  ruleSetId: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/planner/availability-rule-sets?page=1&pageSize=1&ids=${encodeURIComponent(ruleSetId)}`,
    { token },
  )
  expect(response.status(), 'GET /api/planner/availability-rule-sets should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = body?.items?.[0]
  expect(item, 'Rule set response should include the requested record').toBeTruthy()
  const raw = item?.updated_at ?? item?.updatedAt
  expect(typeof raw, 'Rule set response should expose updated_at').toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `Rule set updated_at should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function postWeeklyAvailability(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  lockValue: string,
) {
  return request.fetch(resolveUrl('/api/planner/availability-weekly'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue,
    },
    data,
  })
}

test.describe('TC-PLAN-003: Weekly & Date-specific availability replace APIs', () => {
  test('should replace weekly availability windows for a rule set subject', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let ruleSetId: string | null = null

    try {
      ruleSetId = await createAvailabilityRuleSetFixture(request, token, {
        name: `QA Weekly ${stamp}`,
        timezone: 'UTC',
      })
      const t0 = await fetchRuleSetUpdatedAt(request, token, ruleSetId)

      // Replace weekly: Mon-Fri 09:00-17:00
      const weeklyResponse = await postWeeklyAvailability(
        request,
        token,
        {
          subjectType: 'ruleset',
          subjectId: ruleSetId,
          timezone: 'UTC',
          windows: [
            { weekday: 1, start: '09:00', end: '17:00' },
            { weekday: 2, start: '09:00', end: '17:00' },
            { weekday: 3, start: '09:00', end: '17:00' },
            { weekday: 4, start: '09:00', end: '17:00' },
            { weekday: 5, start: '09:00', end: '17:00' },
          ],
        },
        t0,
      )
      expect(weeklyResponse.status(), 'POST /api/planner/availability-weekly should return 200').toBe(200)
      const weeklyBody = await readJsonSafe<{ ok?: boolean }>(weeklyResponse)
      expect(weeklyBody?.ok).toBe(true)
      const t1 = await fetchRuleSetUpdatedAt(request, token, ruleSetId)
      expect(t1, 'Weekly replace should bump the parent rule set updated_at').not.toBe(t0)

      const staleDeleteResponse = await request.fetch(
        resolveUrl(`/api/planner/availability-rule-sets?id=${encodeURIComponent(ruleSetId)}`),
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: t0,
          },
        },
      )
      expect(staleDeleteResponse.status(), 'Stale rule set delete should return 409').toBe(409)
      const staleDeleteBody = await readJsonSafe<Record<string, unknown>>(staleDeleteResponse)
      expect(staleDeleteBody?.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
      expect(staleDeleteBody?.expectedUpdatedAt).toBe(t0)

      // Verify rules were created by listing availability for the ruleset subject
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      expect(listResponse.status(), 'GET /api/planner/availability should return 200').toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      const rules = listBody?.items ?? []
      expect(rules.length, 'Should have created 5 weekly rules').toBe(5)
      expect(rules.every((rule) => typeof rule.rrule === 'string' && (rule.rrule as string).includes('FREQ=WEEKLY'))).toBe(true)

      // Replace with fewer windows (overwrite)
      const replaceResponse = await postWeeklyAvailability(
        request,
        token,
        {
          subjectType: 'ruleset',
          subjectId: ruleSetId,
          timezone: 'UTC',
          windows: [
            { weekday: 1, start: '10:00', end: '14:00' },
          ],
        },
        t1,
      )
      expect(replaceResponse.status(), 'Second weekly replace should return 200').toBe(200)

      // Verify only 1 rule remains active
      const afterReplaceResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const afterReplaceBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(afterReplaceResponse)
      expect((afterReplaceBody?.items ?? []).length, 'Should have 1 weekly rule after replace').toBe(1)
    } finally {
      await deleteAvailabilityRuleSetIfExists(request, token, ruleSetId)
    }
  })

  test('should replace date-specific availability windows for a team member subject', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let memberId: string | null = null

    try {
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA DateSpec ${stamp}`,
      })

      // Set date-specific availability for two dates (relative to now so the test never expires)
      const targetDate1 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
      const targetDate2 = new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10)

      const dateSpecResponse = await apiRequest(
        request,
        'POST',
        '/api/planner/availability-date-specific',
        {
          token,
          data: {
            subjectType: 'member',
            subjectId: memberId,
            timezone: 'UTC',
            dates: [targetDate1, targetDate2],
            windows: [
              { start: '08:00', end: '12:00' },
            ],
            isAvailable: true,
          },
        },
      )
      expect(dateSpecResponse.status(), 'POST /api/planner/availability-date-specific should return 200').toBe(200)
      const dateSpecBody = await readJsonSafe<{ ok?: boolean }>(dateSpecResponse)
      expect(dateSpecBody?.ok).toBe(true)

      // Verify rules were created
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability?subjectType=member&subjectIds=${encodeURIComponent(memberId)}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      const rules = listBody?.items ?? []
      expect(rules.length).toBeGreaterThanOrEqual(1)
      expect(rules.every((rule) => rule.kind === 'availability')).toBe(true)

      // Replace with unavailability for the same dates
      const unavailResponse = await apiRequest(
        request,
        'POST',
        '/api/planner/availability-date-specific',
        {
          token,
          data: {
            subjectType: 'member',
            subjectId: memberId,
            timezone: 'UTC',
            date: targetDate1,
            windows: [],
            isAvailable: false,
            note: 'Day off',
          },
        },
      )
      expect(unavailResponse.status(), 'Unavailability replace should return 200').toBe(200)

      // Verify the member now has unavailability rules
      const afterResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability?subjectType=member&subjectIds=${encodeURIComponent(memberId)}`,
        { token },
      )
      const afterBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(afterResponse)
      const unavailRules = (afterBody?.items ?? []).filter((rule) => rule.kind === 'unavailability')
      expect(unavailRules.length).toBeGreaterThanOrEqual(1)
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId)
    }
  })
})
