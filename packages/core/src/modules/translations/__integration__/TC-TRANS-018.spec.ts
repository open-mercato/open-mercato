import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'

/**
 * TC-TRANS-018: 403 Forbidden when missing translations.view (GET locales)
 * Surfaces: GET /api/translations/locales
 *
 * The locales read is guarded by translations.view. A principal that lacks the
 * feature must receive 403. Uses a dedicated, freshly-created role (granted no
 * features) and user so the test is fully isolated and safe under parallel
 * workers — it never mutates the shared employee/admin roles other specs rely on.
 */
test.describe('TC-TRANS-018: GET locales denied without translations.view', () => {
  test('returns 403 for a user whose role lacks translations.view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const roleName = `qa_trans_018_noview_${stamp}`
    const userEmail = `qa-trans-018-${stamp}@acme.com`
    const userPassword = 'Valid1!Pass'
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })

      // Grant no features at all, so translations.view is absent for this role.
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: { roleId, features: [] },
      })
      expect(aclResponse.ok()).toBeTruthy()

      userId = await createUserFixture(request, adminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA TC-TRANS-018 User',
      })

      const userToken = await getAuthToken(request, userEmail, userPassword)
      const response = await apiRequest(request, 'GET', '/api/translations/locales', { token: userToken })
      expect(response.status()).toBe(403)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
