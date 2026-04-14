import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createAvailabilityRuleSetFixture,
  deleteAvailabilityRuleSetIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/plannerFixtures'

test.describe('TC-PLAN-002: Availability Rule Set CRUD APIs', () => {
  test('should create, list, search, update, and soft-delete an availability rule set', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const name = `QA Schedule ${stamp}`
    let ruleSetId: string | null = null

    try {
      // Create
      ruleSetId = await createAvailabilityRuleSetFixture(request, token, {
        name,
        timezone: 'Europe/Warsaw',
        description: 'Phase 3 API coverage',
      })

      // List — should include created rule set
      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/planner/availability-rule-sets',
        { token },
      )
      expect(listResponse.status(), 'GET /api/planner/availability-rule-sets should return 200').toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      expect(listBody?.items?.some((item) => item.id === ruleSetId)).toBe(true)

      // Search by name
      const searchResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability-rule-sets?search=${encodeURIComponent(String(stamp))}`,
        { token },
      )
      expect(searchResponse.status(), 'Search by name should return 200').toBe(200)
      const searchBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(searchResponse)
      expect(searchBody?.items?.some((item) => item.id === ruleSetId)).toBe(true)

      // Update
      const updateResponse = await apiRequest(request, 'PUT', '/api/planner/availability-rule-sets', {
        token,
        data: {
          id: ruleSetId,
          name: `${name} Updated`,
          timezone: 'UTC',
        },
      })
      expect(updateResponse.status(), 'PUT /api/planner/availability-rule-sets should return 200').toBe(200)

      // Verify update via ID filter
      const verifyResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability-rule-sets?ids=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      const verifyBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(verifyResponse)
      expect(verifyResponse.status()).toBe(200)
      const updated = verifyBody?.items?.find((item) => item.id === ruleSetId)
      expect(updated?.name).toBe(`${name} Updated`)
      expect(updated?.timezone).toBe('UTC')

      // Delete
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/planner/availability-rule-sets?id=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/planner/availability-rule-sets should return 200').toBe(200)
      ruleSetId = null

      // Verify soft-deleted — should not appear in default list
      const afterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/planner/availability-rule-sets?search=${encodeURIComponent(String(stamp))}`,
        { token },
      )
      const afterDeleteBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(afterDeleteResponse)
      expect(afterDeleteBody?.items?.some((item) => item.name === `${name} Updated`)).toBe(false)
    } finally {
      await deleteAvailabilityRuleSetIfExists(request, token, ruleSetId)
    }
  })
})
