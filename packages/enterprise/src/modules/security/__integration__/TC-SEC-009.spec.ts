import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  getAuthToken,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

test.describe('TC-SEC-009: MFA mutation feature authorization', () => {
  test('rejects every self-service MFA mutation without security.mfa.manage', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `qa-mfa-guard-${stamp}@acme.com`
    const password = 'Valid1!Pass'
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `QA MFA Guard ${stamp}`,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
      })
      const userToken = await getAuthToken(request, email, password)

      const startEnrollment = await apiRequest(
        request,
        'POST',
        '/api/security/mfa/provider/totp',
        { token: userToken, data: {} },
      )
      expect(startEnrollment.status(), 'provider enrollment start should require security.mfa.manage').toBe(403)

      const confirmEnrollment = await apiRequest(
        request,
        'PUT',
        '/api/security/mfa/provider/totp',
        {
          token: userToken,
          data: { setupId: 'blocked-setup', code: '000000' },
        },
      )
      expect(confirmEnrollment.status(), 'provider enrollment confirmation should require security.mfa.manage').toBe(403)

      const regenerateRecoveryCodes = await apiRequest(
        request,
        'POST',
        '/api/security/mfa/recovery-codes/regenerate',
        { token: userToken, data: {} },
      )
      expect(regenerateRecoveryCodes.status(), 'recovery-code regeneration should require security.mfa.manage').toBe(403)

      const deleteMethod = await apiRequest(
        request,
        'DELETE',
        `/api/security/mfa/methods/${randomUUID()}`,
        { token: userToken },
      )
      expect(deleteMethod.status(), 'MFA method deletion should require security.mfa.manage').toBe(403)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
