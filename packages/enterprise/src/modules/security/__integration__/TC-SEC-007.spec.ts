import { expect, test } from '@playwright/test'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollOtpEmail,
  fetchJson,
  loginViaApi,
} from './helpers/securityFixtures'

test.describe('TC-SEC-007: Admin MFA reset and status reporting', () => {
  let adminToken: string
  let targetUserId: string | null = null
  let controlUserId: string | null = null

  test.beforeAll(async ({ request }) => {
    adminToken = await createAdminApiToken(request)

    const targetUser = await createUserFixture(request, adminToken)
    const controlUser = await createUserFixture(request, adminToken)
    targetUserId = targetUser.id
    controlUserId = controlUser.id

    const targetLogin = await fetchJson<{ token: string }>(
      request,
      'POST',
      '/api/auth/login',
      {
        token: adminToken,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        data: undefined,
      },
    ).catch(async () => {
      return null
    })

    void targetLogin
  })

  test.afterAll(async ({ request }) => {
    await deleteUserFixture(request, adminToken ?? null, targetUserId)
    await deleteUserFixture(request, adminToken ?? null, controlUserId)
  })

  test('reports user MFA status, enforces sudo for reset, and leaves unrelated users unchanged', async ({ request }) => {
    const targetUser = await createUserFixture(request, adminToken, { password: 'Valid1!Pass' })
    await deleteUserFixture(request, adminToken ?? null, targetUserId)
    targetUserId = targetUser.id

    const controlUser = await createUserFixture(request, adminToken, { password: 'Valid1!Pass' })
    await deleteUserFixture(request, adminToken ?? null, controlUserId)
    controlUserId = controlUser.id

    const targetLogin = await loginViaApi(request, targetUser.email, targetUser.password)
    const controlLogin = await loginViaApi(request, controlUser.email, controlUser.password)

    await enrollOtpEmail(request, targetLogin.token)

    const statusBeforeReset = await fetchJson<{
      enrolled: boolean
      methods: Array<{ type: string }>
      recoveryCodesRemaining: number
      compliant: boolean
    }>(
      request,
      'GET',
      `/api/security/users/${targetUserId}/mfa/status`,
      { token: adminToken },
    )
    test.skip(
      statusBeforeReset.status === 403,
      'The seeded admin account in this workspace does not have security.admin.manage access, so the admin-reset scenario cannot run here.',
    )
    expect(statusBeforeReset.status).toBe(200)
    expect(statusBeforeReset.body.enrolled).toBe(true)
    expect(statusBeforeReset.body.methods.map((method) => method.type)).toContain('otp_email')

    const complianceResponse = await fetchJson<{ items: Array<{ userId: string; enrolled: boolean }> }>(
      request,
      'GET',
      '/api/security/users/mfa/compliance',
      { token: adminToken },
    )
    expect(complianceResponse.status).toBe(200)
    expect(complianceResponse.body.items.some((item) => item.userId === targetUserId && item.enrolled)).toBe(true)

    const invalidStatus = await fetchJson<{ error?: string }>(
      request,
      'GET',
      '/api/security/users/not-a-uuid/mfa/status',
      { token: adminToken },
    )
    expect(invalidStatus.status).toBe(400)

    const resetWithoutSudo = await fetchJson<{ error?: string }>(
      request,
      'POST',
      `/api/security/users/${targetUserId}/mfa/reset`,
      {
        token: adminToken,
        data: { reason: 'TC-SEC-007 missing sudo' },
      },
    )
    expect(resetWithoutSudo.status).toBe(403)
    expect(resetWithoutSudo.body.error).toBe('sudo_required')

    const adminMethods = await fetchJson<{
      methods: Array<{ type: string; providerMetadata?: Record<string, unknown> | null }>
    }>(
      request,
      'GET',
      '/api/security/mfa/methods',
      { token: adminToken },
    )
    const passkeyMethod = adminMethods.body.methods.find((method) => method.type === 'passkey')
    test.skip(!passkeyMethod, 'This environment needs an admin passkey method to complete sudo-gated reset coverage.')

    const sudoSession = await fetchJson<{ sessionId?: string; method?: string }>(
      request,
      'POST',
      '/api/security/sudo',
      {
        token: adminToken,
        data: {
          targetIdentifier: 'security.admin.mfa.reset',
        },
      },
    )
    expect(sudoSession.status).toBe(200)
    expect(sudoSession.body.method).toBe('mfa')

    const sudoPrepared = await fetchJson<{ clientData?: { challenge?: string } }>(
      request,
      'POST',
      '/api/security/sudo/prepare',
      {
        token: adminToken,
        data: {
          sessionId: sudoSession.body.sessionId,
          methodType: 'passkey',
        },
      },
    )
    expect(sudoPrepared.status).toBe(200)

    const sudoVerify = await fetchJson<{ sudoToken?: string }>(
      request,
      'POST',
      '/api/security/sudo/verify',
      {
        token: adminToken,
        data: {
          sessionId: sudoSession.body.sessionId,
          targetIdentifier: 'security.admin.mfa.reset',
          methodType: 'passkey',
          payload: {
            credentialId: passkeyMethod?.providerMetadata?.credentialId,
            challenge: sudoPrepared.body.clientData?.challenge,
          },
        },
      },
    )
    expect(sudoVerify.status).toBe(200)
    expect(sudoVerify.body.sudoToken).toBeTruthy()

    const resetWithSudo = await fetchJson<{ ok?: boolean }>(
      request,
      'POST',
      `/api/security/users/${targetUserId}/mfa/reset`,
      {
        token: adminToken,
        headers: {
          'x-sudo-token': sudoVerify.body.sudoToken as string,
        },
        data: { reason: 'TC-SEC-007 confirmed admin reset' },
      },
    )
    expect(resetWithSudo.status).toBe(200)
    expect(resetWithSudo.body.ok).toBe(true)

    const statusAfterReset = await fetchJson<{
      enrolled: boolean
      methods: Array<{ type: string }>
      recoveryCodesRemaining: number
    }>(
      request,
      'GET',
      `/api/security/users/${targetUserId}/mfa/status`,
      { token: adminToken },
    )
    expect(statusAfterReset.status).toBe(200)
    expect(statusAfterReset.body.enrolled).toBe(false)
    expect(statusAfterReset.body.methods).toHaveLength(0)

    const controlStatus = await fetchJson<{
      enrolled: boolean
      methods: Array<{ type: string }>
    }>(
      request,
      'GET',
      `/api/security/users/${controlUserId}/mfa/status`,
      { token: adminToken },
    )
    expect(controlStatus.status).toBe(200)
    expect(controlStatus.body.enrolled).toBe(false)
    expect(controlStatus.body.methods).toHaveLength(0)

    const emptyReasonReset = await fetchJson<{ error?: string }>(
      request,
      'POST',
      `/api/security/users/${controlUserId}/mfa/reset`,
      {
        token: adminToken,
        headers: {
          'x-sudo-token': sudoVerify.body.sudoToken as string,
        },
        data: { reason: '' },
      },
    )
    expect(emptyReasonReset.status).toBe(400)

    expect(controlLogin.token).toBeTruthy()
  })
})
