import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test.describe('TC-AUTH-050: User edit hydrates saved role tags', () => {
  test('shows a saved role label when the role is outside the first loaded options page', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenScope(token)
    const stamp = Date.now()
    const roleIds: string[] = []
    let userId: string | null = null

    try {
      const createdRoles = await Promise.all(Array.from({ length: 25 }, (_, index) =>
        createRoleFixture(request, token, {
          name: `QA Role Prefill ${stamp} ${String(index).padStart(2, '0')}`,
        }),
      ))
      roleIds.push(...createdRoles)

      const firstPageResponse = await apiRequest(request, 'GET', '/api/auth/roles?page=1&pageSize=20', { token })
      expect(firstPageResponse.status(), 'role list should return 200').toBe(200)
      const firstPageBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(firstPageResponse)
      const firstPageIds = new Set((firstPageBody?.items ?? []).map((item) => item.id).filter(Boolean))
      const selectedRoleId = roleIds.find((id) => !firstPageIds.has(id)) ?? roleIds[roleIds.length - 1]
      const selectedRoleName = `QA Role Prefill ${stamp} ${String(roleIds.indexOf(selectedRoleId)).padStart(2, '0')}`

      userId = await createUserFixture(request, token, {
        email: `qa-role-prefill-${stamp}@example.com`,
        password: `Password!${stamp}`,
        organizationId,
        name: `QA Role Prefill User ${stamp}`,
        roles: [selectedRoleId],
      })

      await login(page, 'admin')
      await page.goto(`/backend/users/${encodeURIComponent(userId)}/edit`)

      const rolesField = page.locator('[data-crud-field-id="roles"]').first()
      await expect(rolesField).toBeVisible()
      await expect(rolesField).toContainText(selectedRoleName)
      await expect(rolesField).not.toContainText(selectedRoleId)
    } finally {
      await deleteUserIfExists(request, token, userId)
      for (const roleId of roleIds.reverse()) {
        await deleteRoleIfExists(request, token, roleId)
      }
    }
  })
})
