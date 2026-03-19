import { expect, test } from '@playwright/test'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  fetchJson,
  loginViaApi,
} from './helpers/securityFixtures'

type SudoSessionResponse = {
  required: boolean
  sessionId?: string
  method?: 'password' | 'mfa'
  availableMfaMethods?: Array<{ type: string }>
  expiresAt?: string
}

test.describe('TC-SEC-006: Sudo challenge and admin override', () => {
  let adminToken: string
  let targetUserId: string | null = null
  let targetUserEmail = ''
  const targetUserPassword = 'Valid1!Pass'

  test.beforeAll(async ({ request }) => {
    adminToken = await createAdminApiToken(request)
    const targetUser = await createUserFixture(request, adminToken, { password: targetUserPassword })
    targetUserId = targetUser.id
    targetUserEmail = targetUser.email
  })

  test.afterAll(async ({ request }) => {
    await deleteUserFixture(request, adminToken ?? null, targetUserId)
  })

  test('requires sudo, issues a token through MFA, and honors disable/re-enable overrides', async ({ request }) => {
    const adminMethods = await fetchJson<{
      methods: Array<{ type: string; providerMetadata?: Record<string, unknown> | null }>
    }>(
      request,
      'GET',
      '/api/security/mfa/methods',
      { token: adminToken },
    )
    expect(adminMethods.status).toBe(200)

    const passkeyMethod = adminMethods.body.methods.find((method) => method.type === 'passkey')
    test.skip(!passkeyMethod, 'This environment needs an admin passkey method to verify sudo without knowing a seeded TOTP secret.')

    const credentialId = passkeyMethod?.providerMetadata?.credentialId
    expect(typeof credentialId).toBe('string')

    const configsResponse = await fetchJson<{
      items: Array<{ id: string; targetIdentifier: string; isEnabled: boolean }>
    }>(
      request,
      'GET',
      '/api/security/sudo/configs',
      { token: adminToken },
    )
    test.skip(
      configsResponse.status === 403,
      'The seeded admin account in this workspace does not have security.sudo.view access, so sudo-config coverage cannot run here.',
    )
    expect(configsResponse.status).toBe(200)

    const resetConfig = configsResponse.body.items.find((config) => config.targetIdentifier === 'security.admin.mfa.reset')
    const sudoManageConfig = configsResponse.body.items.find((config) => config.targetIdentifier === 'security.sudo.manage')
    expect(resetConfig?.id).toBeTruthy()
    expect(sudoManageConfig?.id).toBeTruthy()

    const resetWithoutSudo = await fetchJson<{ error?: string }>(
      request,
      'POST',
      `/api/security/users/${targetUserId}/mfa/reset`,
      {
        token: adminToken,
        data: { reason: 'TC-SEC-006 initial reset rejection' },
      },
    )
    expect(resetWithoutSudo.status).toBe(403)
    expect(resetWithoutSudo.body.error).toBe('sudo_required')

    const manageSudo = await fetchJson<SudoSessionResponse>(
      request,
      'POST',
      '/api/security/sudo',
      {
        token: adminToken,
        data: {
          targetIdentifier: 'security.sudo.manage',
        },
      },
    )
    expect(manageSudo.status).toBe(200)
    expect(manageSudo.body.required).toBe(true)
    expect(manageSudo.body.method).toBe('mfa')
    expect(manageSudo.body.expiresAt).toBeTruthy()

    const managePrepared = await fetchJson<{ clientData?: { challenge?: string } }>(
      request,
      'POST',
      '/api/security/sudo/prepare',
      {
        token: adminToken,
        data: {
          sessionId: manageSudo.body.sessionId,
          methodType: 'passkey',
        },
      },
    )
    expect(managePrepared.status).toBe(200)

    const manageVerify = await fetchJson<{ sudoToken?: string; expiresAt?: string }>(
      request,
      'POST',
      '/api/security/sudo/verify',
      {
        token: adminToken,
        data: {
          sessionId: manageSudo.body.sessionId,
          targetIdentifier: 'security.sudo.manage',
          methodType: 'passkey',
          payload: {
            credentialId,
            challenge: managePrepared.body.clientData?.challenge,
          },
        },
      },
    )
    expect(manageVerify.status).toBe(200)
    expect(manageVerify.body.sudoToken).toBeTruthy()
    expect(manageVerify.body.expiresAt).toBeTruthy()

    const disableReset = await fetchJson<{ ok?: boolean }>(
      request,
      'PUT',
      `/api/security/sudo/configs/${resetConfig?.id}`,
      {
        token: adminToken,
        headers: {
          'x-sudo-token': manageVerify.body.sudoToken as string,
        },
        data: {
          isEnabled: false,
        },
      },
    )
    expect(disableReset.status).toBe(200)

    const resetWhileDisabled = await fetchJson<{ ok?: boolean }>(
      request,
      'POST',
      `/api/security/users/${targetUserId}/mfa/reset`,
      {
        token: adminToken,
        data: { reason: 'TC-SEC-006 reset while sudo protection disabled' },
      },
    )
    expect(resetWhileDisabled.status).toBe(200)
    expect(resetWhileDisabled.body.ok).toBe(true)

    const reEnableReset = await fetchJson<{ ok?: boolean }>(
      request,
      'PUT',
      `/api/security/sudo/configs/${resetConfig?.id}`,
      {
        token: adminToken,
        headers: {
          'x-sudo-token': manageVerify.body.sudoToken as string,
        },
        data: {
          isEnabled: true,
          challengeMethod: 'auto',
          ttlSeconds: 30,
        },
      },
    )
    expect(reEnableReset.status).toBe(200)

    const resetAfterReEnable = await fetchJson<{ error?: string }>(
      request,
      'POST',
      `/api/security/users/${targetUserId}/mfa/reset`,
      {
        token: adminToken,
        data: { reason: 'TC-SEC-006 reset re-enabled check' },
      },
    )
    expect(resetAfterReEnable.status).toBe(403)
    expect(resetAfterReEnable.body.error).toBe('sudo_required')

    const invalidSudoTokenResponse = await fetchJson<{ error?: string }>(
      request,
      'POST',
      `/api/security/users/${targetUserId}/mfa/reset`,
      {
        token: adminToken,
        headers: {
          'x-sudo-token': `${manageVerify.body.sudoToken}-invalid`,
        },
        data: { reason: 'TC-SEC-006 invalid token rejection' },
      },
    )
    expect(invalidSudoTokenResponse.status).toBe(403)
    expect(invalidSudoTokenResponse.body.error).toBe('sudo_required')

    const userLogin = await loginViaApi(request, targetUserEmail, targetUserPassword)
    expect(userLogin.ok).toBe(true)
  })
})
