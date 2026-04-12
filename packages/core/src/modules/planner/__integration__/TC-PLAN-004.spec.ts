import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createAvailabilityRuleSetFixture,
  createAvailabilityRuleFixture,
  deleteAvailabilityRuleSetIfExists,
  deleteAvailabilityRuleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/plannerFixtures'

test.describe('TC-PLAN-004: Availability rule CRUD & access control', () => {
  test('should create, list, update, and delete an individual availability rule', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let ruleSetId: string | null = null
    let ruleId: string | null = null

    try {
      // Create a rule set as the subject
      ruleSetId = await createAvailabilityRuleSetFixture(request, token, {
        name: `QA RuleCRUD ${stamp}`,
        timezone: 'UTC',
      })

      // Create an individual availability rule
      ruleId = await createAvailabilityRuleFixture(request, token, {
        subjectType: 'ruleset',
        subjectId: ruleSetId,
        timezone: 'UTC',
        rrule: 'DTSTART:20260601T090000Z\nDURATION:PT8H\nRRULE:FREQ=WEEKLY;BYDAY=MO',
        kind: 'availability',
        note: 'Monday shift',
      })

      // List rules for the ruleset subject
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      expect(listResponse.status(), 'GET /api/planner/availability should return 200').toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === ruleId)).toBe(true)

      // Update the rule
      const updateResponse = await apiRequest(request, 'PUT', '/api/planner/availability', {
        token,
        data: {
          id: ruleId,
          note: 'Updated Monday shift',
          rrule: 'DTSTART:20260601T100000Z\nDURATION:PT6H\nRRULE:FREQ=WEEKLY;BYDAY=MO',
        },
      })
      expect(updateResponse.status(), 'PUT /api/planner/availability should return 200').toBe(200)

      // Verify update via list
      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const verifyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(verifyResponse)
      const updatedRule = verifyBody?.items?.find((item) => item.id === ruleId)
      expect(updatedRule?.note).toBe('Updated Monday shift')

      // Delete the rule
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/planner/availability?id=${encodeURIComponent(ruleId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/planner/availability should return 200').toBe(200)
      ruleId = null

      // Verify soft-deleted — should not appear
      const afterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const afterDeleteBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(afterDeleteResponse)
      expect(afterDeleteBody?.items?.some((item) => item.note === 'Updated Monday shift')).toBe(false)
    } finally {
      await deleteAvailabilityRuleIfExists(request, token, ruleId)
      await deleteAvailabilityRuleSetIfExists(request, token, ruleSetId)
    }
  })

  test('should deny employee access to rule set write operations', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = Date.now()
    let ruleSetId: string | null = null

    try {
      // Employee can read rule sets (planner.view granted)
      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/planner/availability-rule-sets',
        { token: employeeToken },
      )
      expect(listResponse.status(), 'Employee GET /api/planner/availability-rule-sets should return 200').toBe(200)

      // Employee cannot create rule sets (requires planner.manage_availability)
      const createResponse = await apiRequest(
        request,
        'POST',
        '/api/planner/availability-rule-sets',
        {
          token: employeeToken,
          data: { name: `QA Blocked ${stamp}`, timezone: 'UTC' },
        },
      )
      expect(createResponse.status(), 'Employee POST /api/planner/availability-rule-sets should be denied').toBe(403)

      // Create one as admin for update/delete denial tests
      ruleSetId = await createAvailabilityRuleSetFixture(request, adminToken, {
        name: `QA Access ${stamp}`,
        timezone: 'UTC',
      })

      // Employee cannot update rule sets
      const updateResponse = await apiRequest(
        request,
        'PUT',
        '/api/planner/availability-rule-sets',
        {
          token: employeeToken,
          data: { id: ruleSetId, name: `QA Access ${stamp} Hacked` },
        },
      )
      expect(updateResponse.status(), 'Employee PUT should be denied').toBe(403)

      // Employee cannot delete rule sets
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/planner/availability-rule-sets?id=${encodeURIComponent(ruleSetId)}`,
        { token: employeeToken },
      )
      expect(deleteResponse.status(), 'Employee DELETE should be denied').toBe(403)

      // Verify rule set is still intact (admin can read)
      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability-rule-sets?ids=${encodeURIComponent(ruleSetId)}`,
        { token: adminToken },
      )
      const verifyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(verifyResponse)
      expect(verifyBody?.items?.some((item) => item.id === ruleSetId)).toBe(true)
    } finally {
      await deleteAvailabilityRuleSetIfExists(request, adminToken, ruleSetId)
    }
  })
})
