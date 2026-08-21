import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const MEMBERS_PATH = '/api/staff/team-members'
const TEAMS_PATH = '/api/staff/teams'
const ROLES_PATH = '/api/staff/team-roles'

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

  test('team role edit shows the saved team immediately on open', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let teamId: string | null = null
    let roleId: string | null = null
    const teamName = `QA Prefill Role Team ${stamp}`
    const roleName = `QA Prefill Role ${stamp}`

    try {
      const teamResponse = await apiRequest(request, 'POST', TEAMS_PATH, {
        token,
        data: { name: teamName, isActive: true },
      })
      expect(teamResponse.status(), 'team fixture create should return 201').toBe(201)
      teamId = expectId((await readJsonSafe<{ id?: string }>(teamResponse))?.id, 'team fixture id')

      const roleResponse = await apiRequest(request, 'POST', ROLES_PATH, {
        token,
        data: { name: roleName, teamId, isActive: true },
      })
      expect(roleResponse.status(), 'role fixture create should return 201').toBe(201)
      roleId = expectId((await readJsonSafe<{ id?: string }>(roleResponse))?.id, 'role fixture id')

      await login(page, 'admin')
      await page.goto(`/backend/staff/team-roles/${encodeURIComponent(roleId)}/edit`, { waitUntil: 'commit' })

      await expect(page.locator('main').getByText('Edit team role').first()).toBeVisible()
      const teamField = page.locator('[data-crud-field-id="teamId"]').first()
      const teamSelect = teamField.getByRole('combobox').first()
      await expect(teamSelect).toBeVisible()
      await expect(teamSelect).toContainText(teamName)
    } finally {
      await deleteGeneralEntityIfExists(request, token, ROLES_PATH, roleId)
      await deleteGeneralEntityIfExists(request, token, TEAMS_PATH, teamId)
    }
  })
})
