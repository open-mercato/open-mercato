import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const MEMBERS_PATH = '/api/staff/team-members'
const TEAMS_PATH = '/api/staff/teams'

// Regression for #2529 (alinadivante comment 4638514821, "TC D"): the saved Team
// must render inside the Member settings select trigger — not only the Highlights
// card — otherwise saving another field silently detaches the member from its team.
test.describe('TC-STAFF-026: Team member edit select prefill', () => {
  test('member settings team select shows the saved team in the trigger', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let teamId: string | null = null
    let memberId: string | null = null
    const teamName = `QA Member Team ${stamp}`
    const memberName = `QA Member ${stamp}`

    try {
      const teamResponse = await apiRequest(request, 'POST', TEAMS_PATH, {
        token,
        data: { name: teamName, isActive: true },
      })
      expect(teamResponse.status(), 'team fixture create should return 201').toBe(201)
      teamId = expectId((await readJsonSafe<{ id?: string }>(teamResponse))?.id, 'team fixture id')

      const memberResponse = await apiRequest(request, 'POST', MEMBERS_PATH, {
        token,
        data: { displayName: memberName, teamId, isActive: true },
      })
      expect(memberResponse.status(), 'member fixture create should return 201').toBe(201)
      memberId = expectId((await readJsonSafe<{ id?: string }>(memberResponse))?.id, 'member fixture id')

      await login(page, 'admin')
      await page.goto(`/backend/staff/team-members/${encodeURIComponent(memberId)}`, { waitUntil: 'commit' })

      await expect(page.getByRole('heading', { name: 'Member settings' }).first()).toBeVisible()
      const teamField = page.locator('[data-crud-field-id="teamId"]').first()
      const teamSelect = teamField.getByRole('combobox').first()
      await expect(teamSelect).toBeVisible()
      await expect(teamSelect).toContainText(teamName)
    } finally {
      await deleteGeneralEntityIfExists(request, token, MEMBERS_PATH, memberId)
      await deleteGeneralEntityIfExists(request, token, TEAMS_PATH, teamId)
    }
  })
})
