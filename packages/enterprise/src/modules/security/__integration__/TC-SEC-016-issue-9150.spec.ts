import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createUserFixture, deleteUserFixture, fetchJson, loginViaApi } from './helpers/securityFixtures'

test('TC-SEC-016: tenant security admin cannot inspect or reset a superadmin MFA target', async ({ request }) => {
  const operatorToken = await getAuthToken(request, 'superadmin')
  let securityRoleId: string | null = null
  let privilegedRoleId: string | null = null
  const userIds: string[] = []
  try {
    securityRoleId = await createRoleFixture(request, operatorToken, { name: 'qa-9150-security-' + randomUUID() })
    await setRoleAclFeatures(request, operatorToken, {
      roleId: securityRoleId, features: ['security.admin.manage'], organizations: null,
    })
    privilegedRoleId = await createRoleFixture(request, operatorToken, { name: 'qa-9150-superadmin-' + randomUUID() })
    const grant = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token: operatorToken,
      data: { roleId: privilegedRoleId, features: ['*'], isSuperAdmin: true, organizations: null },
    })
    expect(grant.status()).toBe(200)

    const actor = await createUserFixture(request, operatorToken, { roles: [securityRoleId] })
    userIds.push(actor.id)
    const protectedTarget = await createUserFixture(request, operatorToken, { roles: [privilegedRoleId] })
    userIds.push(protectedTarget.id)
    const ordinaryTarget = await createUserFixture(request, operatorToken, { roles: [securityRoleId] })
    userIds.push(ordinaryTarget.id)
    const actorLogin = await loginViaApi(request, actor.email, actor.password)
    expect(actorLogin.mfa_required).not.toBe(true)

    const status = await fetchJson(request, 'GET', '/api/security/users/' + protectedTarget.id + '/mfa/status', {
      token: actorLogin.token,
    })
    expect(status.status).toBe(403)
    const reset = await fetchJson<{ error?: string }>(request, 'POST', '/api/security/users/' + protectedTarget.id + '/mfa/reset', {
      token: actorLogin.token, data: { reason: 'issue 9150 target protection' },
    })
    expect(reset.status).toBe(403)
    expect(reset.body.error).not.toBe('sudo_required')

    const ordinaryStatus = await fetchJson(request, 'GET', '/api/security/users/' + ordinaryTarget.id + '/mfa/status', {
      token: actorLogin.token,
    })
    expect(ordinaryStatus.status).toBe(200)
    const ordinaryReset = await fetchJson<{ error?: string }>(request, 'POST', '/api/security/users/' + ordinaryTarget.id + '/mfa/reset', {
      token: actorLogin.token, data: { reason: 'issue 9150 sudo preserved' },
    })
    expect(ordinaryReset.status).toBe(403)
    expect(ordinaryReset.body.error).toBe('sudo_required')

    const privilegedStatus = await fetchJson(request, 'GET', '/api/security/users/' + protectedTarget.id + '/mfa/status', {
      token: operatorToken,
    })
    expect(privilegedStatus.status).toBe(200)
  } finally {
    for (const userId of userIds.reverse()) await deleteUserFixture(request, operatorToken, userId)
    await deleteRoleIfExists(request, operatorToken, privilegedRoleId)
    await deleteRoleIfExists(request, operatorToken, securityRoleId)
  }
})
