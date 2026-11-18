import { randomUUID } from 'node:crypto'
import { createRoleFixture, deleteRoleIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createAdminApiToken, createUserFixture, deleteUserFixture, fetchJson, loginViaApi } from './helpers/securityFixtures'

test.describe('TC-SEC-017: MFA self-management step-up and Email OTP verification', () => {
  test('rejects session-only mutations and confirms only the emailed setup code', async ({ request }) => {
    const adminToken = await createAdminApiToken(request)
    const roleId = await createRoleFixture(request, adminToken, { name: `MFA hardening ${randomUUID()}` })
    let user: Awaited<ReturnType<typeof createUserFixture>> | null = null
    try {
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['security.mfa.manage'] })
      user = await createUserFixture(request, adminToken, { roles: [roleId] })
      const login = await loginViaApi(request, user.email, user.password)
      const token = login.token
      const setup = await fetchJson<{ setupId: string; clientData: { code: string } }>(request, 'POST', '/api/security/mfa/provider/otp_email', { token, data: {} })
      expect(setup.status).toBe(200)
      expect(setup.body.clientData.code).toMatch(/^\d{6}$/)
      const unstepped = await apiRequest(request, 'PUT', '/api/security/mfa/provider/otp_email', {
        token, data: { setupId: setup.body.setupId, payload: { code: setup.body.clientData.code } },
      })
      expect(unstepped.status()).toBe(403)
      expect((await unstepped.json()).error).toBe('sudo_required')

      const empty = await fetchJson(request, 'PUT', '/api/security/mfa/provider/otp_email', { token, data: { setupId: setup.body.setupId, payload: {} } })
      expect(empty.status).toBe(400)
      const wrong = setup.body.clientData.code === '000000' ? '111111' : '000000'
      const invalid = await fetchJson(request, 'PUT', '/api/security/mfa/provider/otp_email', { token, data: { setupId: setup.body.setupId, payload: { code: wrong } } })
      expect(invalid.status).toBe(400)
      const confirmed = await fetchJson(request, 'PUT', '/api/security/mfa/provider/otp_email', {
        token, data: { setupId: setup.body.setupId, payload: { code: setup.body.clientData.code, email: 'unverified@example.test' } },
      })
      expect(confirmed.status).toBe(200)
      const methods = await fetchJson<{ methods: Array<{ id: string; type: string; providerMetadata: { email?: string } }> }>(request, 'GET', '/api/security/mfa/methods', { token })
      const emailMethod = methods.body.methods.find((method) => method.type === 'otp_email')
      expect(emailMethod?.providerMetadata.email).toBe(user.email)
      expect((await fetchJson(request, 'PUT', '/api/security/mfa/provider/otp_email', { token, data: { setupId: setup.body.setupId, payload: { code: setup.body.clientData.code } } })).status).not.toBe(200)

      const recoveryDenied = await apiRequest(request, 'POST', '/api/security/mfa/recovery-codes/regenerate', { token, data: {} })
      expect(recoveryDenied.status()).toBe(403)
      const removalDenied = await apiRequest(request, 'DELETE', `/api/security/mfa/methods/${emailMethod?.id}`, { token })
      expect(removalDenied.status()).toBe(403)
      const recovery = await fetchJson<{ recoveryCodes: string[] }>(request, 'POST', '/api/security/mfa/recovery-codes/regenerate', { token, data: {} })
      expect(recovery.status).toBe(200)
      expect(recovery.body.recoveryCodes).toHaveLength(10)
      expect((await fetchJson(request, 'DELETE', `/api/security/mfa/methods/${emailMethod?.id}`, { token })).status).toBe(200)
    } finally {
      await deleteUserFixture(request, adminToken, user?.id ?? null)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
