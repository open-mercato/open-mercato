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
  test('permits compelled enrollment while retaining the MFA management gate', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const stamp = randomUUID()
    const email = `qa-mfa-guard-${stamp}@acme.com`
    const password = 'Valid1!Pass'
    let policyId: string | null = null
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

      const policyResponse = await apiRequest(
        request,
        'POST',
        '/api/security/enforcement',
        {
          token: adminToken,
          data: {
            scope: 'organisation',
            tenantId,
            organizationId,
            isEnforced: true,
            allowedMethods: ['totp'],
          },
        },
      )
      expect(policyResponse.status(), 'enforcement policy fixture should be created').toBe(201)
      const policyBody = await policyResponse.json() as { id?: string }
      expect(typeof policyBody.id).toBe('string')
      policyId = policyBody.id ?? null

      const compelledEnrollment = await apiRequest(
        request,
        'POST',
        '/api/security/mfa/provider/totp',
        { token: userToken, data: {} },
      )
      expect(compelledEnrollment.status(), 'active enforcement should permit enrollment setup').toBe(200)
      const setupBody = await compelledEnrollment.json() as { setupId?: string }
      expect(typeof setupBody.setupId).toBe('string')

      const compelledConfirmation = await apiRequest(
        request,
        'PUT',
        '/api/security/mfa/provider/totp',
        {
          token: userToken,
          data: { setupId: setupBody.setupId, code: '000000' },
        },
      )
      expect(compelledConfirmation.status(), 'active enforcement should reach provider confirmation').not.toBe(403)

      const stillProtectedRecoveryCodes = await apiRequest(
        request,
        'POST',
        '/api/security/mfa/recovery-codes/regenerate',
        { token: userToken, data: {} },
      )
      expect(stillProtectedRecoveryCodes.status(), 'non-enrollment management should remain feature-gated').toBe(403)
    } finally {
      if (policyId) {
        await apiRequest(request, 'DELETE', `/api/security/enforcement/${policyId}`, {
          token: adminToken,
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
