import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createAvailabilityRuleSetFixture,
  deleteAvailabilityRuleSetIfExists,
} from '@open-mercato/core/helpers/integration/plannerFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

const CLEANUP_BATCH_SIZE = 10

test.describe('TC-PLAN-005: Availability editor hydrates saved rule set', () => {
  test('shows the saved rule set when it is outside the first loaded options page', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const ruleSetIds: string[] = []
    let memberId: string | null = null

    try {
      for (let start = 0; start < 105; start += 25) {
        const createdBatch = await Promise.all(Array.from({ length: Math.min(25, 105 - start) }, (_, offset) => {
          const index = start + offset
          return createAvailabilityRuleSetFixture(request, token, {
            name: `QA Schedule Prefill ${stamp} ${String(index).padStart(3, '0')}`,
            timezone: 'UTC',
          })
        }))
        ruleSetIds.push(...createdBatch)
      }

      const firstPageResponse = await apiRequest(
        request,
        'GET',
        '/api/planner/availability-rule-sets?page=1&pageSize=100',
        { token },
      )
      expect(firstPageResponse.status(), 'rule set list should return 200').toBe(200)
      const firstPageBody = await firstPageResponse.json() as { items?: Array<{ id?: string }> }
      const firstPageIds = new Set((firstPageBody.items ?? []).map((item) => item.id).filter(Boolean))
      const selectedRuleSetId = ruleSetIds.find((id) => !firstPageIds.has(id)) ?? ruleSetIds[ruleSetIds.length - 1]
      const selectedRuleSetName = `QA Schedule Prefill ${stamp} ${String(ruleSetIds.indexOf(selectedRuleSetId)).padStart(3, '0')}`

      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA Availability Member ${stamp}`,
      })

      const updateResponse = await apiRequest(request, 'PUT', '/api/staff/team-members', {
        token,
        data: {
          id: memberId,
          availabilityRuleSetId: selectedRuleSetId,
        },
      })
      expect(updateResponse.status(), 'staff member ruleset update should return 200').toBe(200)

      await login(page, 'admin')
      await page.goto(`/backend/staff/team-members/${encodeURIComponent(memberId)}`)
      await page.getByRole('tab', { name: /availability/i }).click()

      const ruleSetSelect = page.getByText('Schedule').locator('xpath=following::button[@role="combobox"][1]')
      await expect(ruleSetSelect).toBeVisible()
      await expect(ruleSetSelect).toContainText(selectedRuleSetName)
    } finally {
      await deleteStaffEntityIfExists(request, token, '/api/staff/team-members', memberId)
      for (let start = 0; start < ruleSetIds.length; start += CLEANUP_BATCH_SIZE) {
        await Promise.all(
          ruleSetIds
            .slice(start, start + CLEANUP_BATCH_SIZE)
            .map((ruleSetId) => deleteAvailabilityRuleSetIfExists(request, token, ruleSetId)),
        )
      }
    }
  })
})
