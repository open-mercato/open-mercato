import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const MEMBERS_PATH = '/api/staff/team-members'
const TEAMS_PATH = '/api/staff/teams'

test.describe('TC-STAFF-025: Edit forms prefill saved relation selects', () => {
  test('team member edit shows the saved team immediately on open', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let teamId: string | null = null
    let memberId: string | null = null
    const teamName = `QA Prefill Team ${stamp}`
    const memberName = `QA Prefill Member ${stamp}`

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
      await page.goto(`/backend/staff/team-members/${encodeURIComponent(memberId)}`)

      await expect(page.getByRole('heading', { name: memberName }).first()).toBeVisible()
      await expect(page.getByText(teamName).first()).toBeVisible()
    } finally {
      await deleteGeneralEntityIfExists(request, token, MEMBERS_PATH, memberId)
      await deleteGeneralEntityIfExists(request, token, TEAMS_PATH, teamId)
    }
  })
})
