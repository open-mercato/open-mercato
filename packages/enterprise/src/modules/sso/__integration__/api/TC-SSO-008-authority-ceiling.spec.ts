import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest, getAuthToken, postForm, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createScimTokenFixture, scimRequest } from '../helpers/ssoFixtures'

type AuthorityFixture = {
  adminToken: string
  adminUserId: string
  managerToken: string
  managerUserId: string
  managerRoleId: string
  managerRoleName: string
  privilegedRoleId: string
  privilegedRoleName: string
  organizationId: string
  tenantId: string
  userIds: string[]
  configIds: string[]
  tokenIds: string[]
}

async function withAuthorityFixture(
  request: APIRequestContext,
  run: (fixture: AuthorityFixture) => Promise<void>,
): Promise<void> {
  const adminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, userId: adminUserId } = getTokenScope(adminToken)
  expect(tenantId).toBeTruthy()
  expect(adminUserId).toBeTruthy()
  const stamp = randomUUID()
  const userIds: string[] = []
  const roleIds: string[] = []
  const configIds: string[] = []
  const tokenIds: string[] = []
  let organizationId: string | null = null
  try {
    organizationId = await createOrganizationFixture(request, adminToken, {
      name: `SSO authority ${stamp}`, tenantId,
    })
    const managerRoleName = `sso-manager-${stamp}`
    const managerRoleId = await createRoleFixture(request, adminToken, { name: managerRoleName, tenantId })
    roleIds.push(managerRoleId)
    await setRoleAclFeatures(request, adminToken, {
      roleId: managerRoleId,
      features: ['sso.config.view', 'sso.config.manage', 'sso.scim.manage'],
      organizations: null,
    })
    const privilegedRoleName = `directory-reviewer-${stamp}`
    const privilegedRoleId = await createRoleFixture(request, adminToken, { name: privilegedRoleName, tenantId })
    roleIds.push(privilegedRoleId)
    const elevateRole = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token: adminToken,
      data: { roleId: privilegedRoleId, tenantId, isSuperAdmin: true, features: ['*'], organizations: null },
    })
    expect(elevateRole.status()).toBe(200)
    const managerEmail = `sso-manager-${stamp}@example.com`
    const password = `Test-${randomUUID()}!`
    const managerUserId = await createUserFixture(request, adminToken, {
      email: managerEmail, password, organizationId, roles: [managerRoleId], name: 'SSO fixture manager',
    })
    userIds.push(managerUserId)
    const managerToken = await getAuthToken(request, managerEmail, password)
    await run({
      adminToken, adminUserId, managerToken, managerUserId, managerRoleId, managerRoleName,
      privilegedRoleId, privilegedRoleName, organizationId, tenantId, userIds, configIds, tokenIds,
    })
  } finally {
    if (organizationId) {
      const cleanupOrganizationId = organizationId
      await withClient(async (client) => {
        const configs = await client.query<{ id: string }>(
          'select id from sso_configs where organization_id = $1 and tenant_id = $2',
          [cleanupOrganizationId, tenantId],
        )
        const users = await client.query<{ id: string }>(
          'select id from users where organization_id = $1 and tenant_id = $2',
          [cleanupOrganizationId, tenantId],
        )
        for (const config of configs.rows) if (!configIds.includes(config.id)) configIds.push(config.id)
        for (const user of users.rows) if (!userIds.includes(user.id)) userIds.push(user.id)
        const tokens = await client.query<{ id: string }>(
          'select id from scim_tokens where sso_config_id = any($1::uuid[]) and organization_id = $2 and tenant_id = $3',
          [configIds, cleanupOrganizationId, tenantId],
        )
        for (const token of tokens.rows) if (!tokenIds.includes(token.id)) tokenIds.push(token.id)
      })
    }
    for (const tokenId of tokenIds) {
      await apiRequest(request, 'DELETE', `/api/sso/scim/tokens/${tokenId}`, { token: adminToken }).catch(() => undefined)
    }
    for (const configId of configIds) {
      await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, {
        token: adminToken, data: { active: false },
      }).catch(() => undefined)
      await apiRequest(request, 'DELETE', `/api/sso/config/${configId}`, { token: adminToken }).catch(() => undefined)
    }
    for (const userId of [...userIds].reverse()) await deleteUserIfExists(request, adminToken, userId)
    for (const roleId of [...roleIds].reverse()) await deleteRoleIfExists(request, adminToken, roleId)
    await deleteOrganizationIfExists(request, adminToken, organizationId)
    if (organizationId) {
      const cleanupOrganizationId = organizationId
      await withClient(async (client) => {
        const active = await client.query<{ users: number; roles: number; organizations: number }>(
          `select
             (select count(*)::int from users where id = any($1::uuid[]) and organization_id = $2 and tenant_id = $3 and deleted_at is null) as users,
             (select count(*)::int from roles where id = any($4::uuid[]) and tenant_id = $3 and deleted_at is null) as roles,
             (select count(*)::int from organizations where id = $2 and tenant_id = $3 and deleted_at is null) as organizations`,
          [userIds, cleanupOrganizationId, tenantId, roleIds],
        )
        expect(active.rows[0]).toEqual({ users: 0, roles: 0, organizations: 0 })
        for (const table of ['sso_role_grants', 'sso_user_deactivations', 'scim_provisioning_log', 'sso_identities', 'scim_tokens']) {
          await client.query(
            `delete from ${table} where sso_config_id = any($1::uuid[]) and organization_id = $2 and tenant_id = $3`,
            [configIds, cleanupOrganizationId, tenantId],
          )
        }
        await client.query(
          'delete from sso_configs where id = any($1::uuid[]) and organization_id = $2 and tenant_id = $3',
          [configIds, cleanupOrganizationId, tenantId],
        )
        const remaining = await client.query<{ count: number }>(
          'select count(*)::int as count from sso_configs where id = any($1::uuid[]) and organization_id = $2 and tenant_id = $3',
          [configIds, cleanupOrganizationId, tenantId],
        )
        expect(remaining.rows[0]?.count).toBe(0)
      })
    }
  }
}

function configPayload(fixture: AuthorityFixture, mappings: Record<string, string> = {}) {
  return {
    name: `Authority config ${randomUUID()}`,
    organizationId: fixture.organizationId,
    tenantId: fixture.tenantId,
    protocol: 'oidc',
    issuer: 'https://idp.example.com',
    clientId: `authority-${randomUUID()}`,
    clientSecret: randomUUID(),
    allowedDomains: ['example.com'],
    jitEnabled: false,
    autoLinkByEmail: true,
    appRoleMappings: mappings,
  }
}

async function createConfig(request: APIRequestContext, fixture: AuthorityFixture, mappings: Record<string, string> = {}) {
  const response = await apiRequest(request, 'POST', '/api/sso/config', {
    token: fixture.adminToken, data: configPayload(fixture, mappings),
  })
  expect(response.status()).toBe(201)
  const configId = (await readJsonSafe<{ id: string }>(response))?.id
  expect(configId).toBeTruthy()
  fixture.configIds.push(configId!)
  return configId!
}

async function readConfigAuthority(fixture: AuthorityFixture, configId: string) {
  return withClient(async (client) => {
    const config = await client.query<{ authorization_user_id: string | null; issuer: string; app_role_mappings: Record<string, string> }>(
      'select authorization_user_id, issuer, app_role_mappings from sso_configs where id = $1 and organization_id = $2 and tenant_id = $3 and deleted_at is null',
      [configId, fixture.organizationId, fixture.tenantId],
    )
    expect(config.rows).toHaveLength(1)
    return config.rows[0]
  })
}

async function createFixtureUser(request: APIRequestContext, fixture: AuthorityFixture, roles: string[] = []) {
  const email = `sso-target-${randomUUID()}@example.com`
  const userId = await createUserFixture(request, fixture.adminToken, {
    email, password: `Test-${randomUUID()}!`, organizationId: fixture.organizationId, roles, name: 'Original fixture name',
  })
  fixture.userIds.push(userId)
  return { userId, email }
}

async function activateFixture(fixture: AuthorityFixture, configId: string) {
  await withClient(async (client) => {
    const result = await client.query(
      'update sso_configs set is_active = true where id = $1 and organization_id = $2 and tenant_id = $3 and deleted_at is null',
      [configId, fixture.organizationId, fixture.tenantId],
    )
    expect(result.rowCount).toBe(1)
  })
}

async function issueToken(request: APIRequestContext, fixture: AuthorityFixture, configId: string) {
  const token = await createScimTokenFixture(request, fixture.managerToken, configId, `Authority ${randomUUID()}`)
  fixture.tokenIds.push(token.tokenId)
  await withClient(async (client) => {
    const persisted = await client.query<{ created_by: string }>(
      'select created_by from scim_tokens where id = $1 and sso_config_id = $2 and organization_id = $3 and tenant_id = $4',
      [token.tokenId, configId, fixture.organizationId, fixture.tenantId],
    )
    expect(persisted.rows[0]?.created_by).toBe(fixture.managerUserId)
  })
  return token
}

test.describe('TC-SSO-008: SSO authority ceilings', () => {
  test('rejects privileged role mappings and records only server-derived config authority', async ({ request }) => {
    await withAuthorityFixture(request, async (fixture) => {
      const privilegedMapping = { claimed: `  ${fixture.privilegedRoleName.toUpperCase()}  ` }
      const deniedCreate = await apiRequest(request, 'POST', '/api/sso/config', {
        token: fixture.managerToken,
        data: { ...configPayload(fixture, privilegedMapping), authorizationUserId: fixture.adminUserId },
      })
      expect(deniedCreate.status()).toBe(403)
      await withClient(async (client) => {
        const count = await client.query<{ count: number }>(
          'select count(*)::int as count from sso_configs where organization_id = $1 and tenant_id = $2 and deleted_at is null',
          [fixture.organizationId, fixture.tenantId],
        )
        expect(count.rows[0]?.count).toBe(0)
      })
      const configId = await createConfig(request, fixture, privilegedMapping)
      const original = await readConfigAuthority(fixture, configId)
      expect(original.authorization_user_id).toBe(fixture.adminUserId)
      for (const data of [
        { appRoleMappings: privilegedMapping, authorizationUserId: fixture.adminUserId },
        { issuer: 'https://controlled.example.com', authorizationUserId: fixture.adminUserId },
      ]) {
        const deniedUpdate = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, { token: fixture.managerToken, data })
        expect(deniedUpdate.status()).toBe(403)
        expect(await readConfigAuthority(fixture, configId)).toEqual(original)
      }
      const ordinaryMapping = { staff: fixture.managerRoleName }
      const allowedUpdate = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, {
        token: fixture.managerToken,
        data: { appRoleMappings: ordinaryMapping, authorizationUserId: fixture.adminUserId },
      })
      expect(allowedUpdate.status()).toBe(200)
      expect(await readConfigAuthority(fixture, configId)).toEqual({
        authorization_user_id: fixture.managerUserId,
        issuer: original.issuer,
        app_role_mappings: ordinaryMapping,
      })
    })
  })

  test('denies privileged SCIM targets and protects accounts elevated after linking', async ({ request }) => {
    await withAuthorityFixture(request, async (fixture) => {
      const elevated = await createFixtureUser(request, fixture, [fixture.privilegedRoleId])
      const ordinary = await createFixtureUser(request, fixture)
      const configId = await createConfig(request, fixture)
      await activateFixture(fixture, configId)
      const token = await issueToken(request, fixture, configId)
      const denied = await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', token.rawToken, {
        userName: elevated.email, externalId: randomUUID(), active: true,
      })
      expect(denied.status()).toBe(403)
      await withClient(async (client) => {
        const identities = await client.query<{ count: number }>(
          'select count(*)::int as count from sso_identities where user_id = $1 and sso_config_id = $2 and organization_id = $3 and tenant_id = $4',
          [elevated.userId, configId, fixture.organizationId, fixture.tenantId],
        )
        expect(identities.rows[0]?.count).toBe(0)
      })
      const linked = await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', token.rawToken, {
        userName: ordinary.email, externalId: randomUUID(), active: true,
      })
      expect(linked.status()).toBe(201)
      const identityId = (await readJsonSafe<{ id: string }>(linked))?.id
      expect(identityId).toBeTruthy()
      await withAuthorityFixture(request, async (otherScope) => {
        const otherUser = await createFixtureUser(request, otherScope)
        const otherConfigId = await createConfig(request, otherScope)
        await activateFixture(otherScope, otherConfigId)
        const otherToken = await issueToken(request, otherScope, otherConfigId)
        const otherLinked = await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', otherToken.rawToken, {
          userName: otherUser.email, externalId: randomUUID(), active: true,
        })
        expect(otherLinked.status()).toBe(201)
        const otherIdentityId = (await readJsonSafe<{ id: string }>(otherLinked))?.id
        expect(otherIdentityId).toBeTruthy()
        const crossScope = await scimRequest(request, 'GET', `/api/sso/scim/v2/Users/${otherIdentityId}`, token.rawToken)
        expect(crossScope.status()).toBe(404)
        expect((await crossScope.text())).not.toContain(otherUser.email)
        expect((await scimRequest(request, 'GET', `/api/sso/scim/v2/Users/${identityId}`, otherToken.rawToken)).status()).toBe(404)
      })
      const elevateUser = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: fixture.adminToken,
        data: { userId: ordinary.userId, tenantId: fixture.tenantId, isSuperAdmin: true, features: ['*'], organizations: null },
      })
      expect(elevateUser.status()).toBe(200)
      const before = await withClient(async (client) => {
        const user = await client.query<{ updated_at: Date }>(
          'select updated_at from users where id = $1 and organization_id = $2 and tenant_id = $3',
          [ordinary.userId, fixture.organizationId, fixture.tenantId],
        )
        return user.rows[0]
      })
      const deniedPatch = await scimRequest(request, 'PATCH', `/api/sso/scim/v2/Users/${identityId}`, token.rawToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Impersonated fixture' }],
      })
      expect(deniedPatch.status()).toBe(403)
      expect((await scimRequest(request, 'DELETE', `/api/sso/scim/v2/Users/${identityId}`, token.rawToken)).status()).toBe(403)
      await withClient(async (client) => {
        const user = await client.query<{ updated_at: Date }>(
          'select updated_at from users where id = $1 and organization_id = $2 and tenant_id = $3',
          [ordinary.userId, fixture.organizationId, fixture.tenantId],
        )
        expect(user.rows[0]).toEqual(before)
        const deactivations = await client.query<{ count: number }>(
          'select count(*)::int as count from sso_user_deactivations where user_id = $1 and sso_config_id = $2 and organization_id = $3 and tenant_id = $4',
          [ordinary.userId, configId, fixture.organizationId, fixture.tenantId],
        )
        expect(deactivations.rows[0]?.count).toBe(0)
      })
    })
  })

  test('shows the translated error when an SSO configuration save is refused', async ({ request, page, baseURL }) => {
    await withAuthorityFixture(request, async (fixture) => {
      const configId = await createConfig(request, fixture)
      const cookieUrl = baseURL ?? 'http://localhost:3000'
      await page.context().addCookies([
        { name: 'auth_token', value: fixture.managerToken, url: cookieUrl },
        { name: 'locale', value: 'en', url: cookieUrl },
      ])
      await page.goto(`/backend/sso/config/${configId}`)
      const name = page.getByLabel('Configuration Name', { exact: true })
      await expect(name).toHaveValue(/^Authority config /)
      await name.fill('This change must be refused')

      const update = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, {
        token: fixture.adminToken,
        data: { appRoleMappings: { 'idp-privileged': fixture.privilegedRoleName } },
      })
      expect(update.status()).toBe(200)
      const rejectedSave = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && response.url().endsWith(`/api/sso/config/${configId}`))
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      expect((await rejectedSave).status()).toBe(403)
      await expect(page.getByText(/SSO authorization is no longer valid/)).toBeVisible()
    })
  })

  test('rejects existing SSO access and refresh credentials after the config author loses authority', async ({ request }) => {
    await withAuthorityFixture(request, async (fixture) => {
      const response = await apiRequest(request, 'POST', '/api/sso/config', {
        token: fixture.managerToken, data: configPayload(fixture),
      })
      expect(response.status()).toBe(201)
      const config = await readJsonSafe<{ id: string }>(response)
      if (!config?.id) throw new Error('[internal] Missing fixture SSO config ID')
      fixture.configIds.push(config.id)
      await activateFixture(fixture, config.id)

      const email = `sso-session-${randomUUID()}@example.com`
      const password = `Test-${randomUUID()}!`
      const userId = await createUserFixture(request, fixture.adminToken, {
        email, password, organizationId: fixture.organizationId, roles: [], name: 'SSO session fixture',
      })
      fixture.userIds.push(userId)

      await withCredentialIsolatedRequest(async (isolated) => {
        const login = await postForm(isolated, '/api/auth/login', { email, password, remember: '1' })
        expect(login.status()).toBe(200)
        const credentials = await readJsonSafe<{ token: string; refreshToken: string }>(login)
        if (!credentials?.token || !credentials.refreshToken) throw new Error('[internal] Missing fixture credentials')
        const { sid } = JSON.parse(Buffer.from(credentials.token.split('.')[1], 'base64url').toString()) as { sid: string }

        await withClient(async (client) => {
          const { rows } = await client.query<{ updated_at: Date }>(
            'select updated_at from sso_configs where id = $1 and organization_id = $2 and tenant_id = $3',
            [config.id, fixture.organizationId, fixture.tenantId],
          )
          const provenance = { configId: config.id, configUpdatedAt: rows[0].updated_at.getTime() }
          const scoped = await client.query(
            'update sessions set sso_provenance = $1::jsonb where id = $2 and user_id = $3',
            [JSON.stringify(provenance), sid, userId],
          )
          expect(scoped.rowCount).toBe(1)
        })

        const profile = () => apiRequest(isolated, 'GET', '/api/auth/profile', { token: credentials.token })
        const refresh = () => isolated.post('/api/auth/session/refresh', {
          data: { refreshToken: credentials.refreshToken },
        })
        expect((await profile()).status()).toBe(200)
        expect((await refresh()).status()).toBe(200)
        await setRoleAclFeatures(request, fixture.adminToken, {
          roleId: fixture.managerRoleId,
          features: ['sso.config.view'],
          organizations: null,
        })
        expect((await profile()).status()).toBe(401)
        expect((await refresh()).status()).toBe(401)

        const passwordLogin = await postForm(isolated, '/api/auth/login', { email, password, remember: '1' })
        expect(passwordLogin.status()).toBe(200)
        const passwordCredentials = await readJsonSafe<{ refreshToken: string }>(passwordLogin)
        expect(passwordCredentials?.refreshToken).toBeTruthy()
        const passwordRefresh = await isolated.post('/api/auth/session/refresh', {
          data: { refreshToken: passwordCredentials?.refreshToken },
        })
        expect(passwordRefresh.status()).toBe(200)
      })
    })
  })

  test('requires explicit config reauthorization and token replacement for legacy provenance', async ({ request }) => {
    await withAuthorityFixture(request, async (fixture) => {
      const configId = await createConfig(request, fixture)
      await activateFixture(fixture, configId)
      const legacyToken = await issueToken(request, fixture, configId)
      const email = `sso-recovery-${randomUUID()}@example.com`
      const payload = { userName: email, externalId: randomUUID(), active: true }
      const originalUserCount = await withClient(async (client) => {
        const users = await client.query<{ count: number }>(
          'select count(*)::int as count from users where organization_id = $1 and tenant_id = $2 and deleted_at is null',
          [fixture.organizationId, fixture.tenantId],
        )
        return users.rows[0].count
      })
      await withClient(async (client) => {
        const updated = await client.query(
          'update sso_configs set authorization_user_id = null where id = $1 and organization_id = $2 and tenant_id = $3',
          [configId, fixture.organizationId, fixture.tenantId],
        )
        expect(updated.rowCount).toBe(1)
      })
      expect((await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', legacyToken.rawToken, payload)).status()).toBe(403)
      const deniedToken = await apiRequest(request, 'POST', '/api/sso/scim/tokens', {
        token: fixture.managerToken, data: { ssoConfigId: configId, name: 'Denied legacy config token' },
      })
      expect(deniedToken.status()).toBe(403)
      const reauthorized = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, {
        token: fixture.adminToken, data: { name: `Reauthorized ${randomUUID()}` },
      })
      expect(reauthorized.status()).toBe(200)
      expect((await readConfigAuthority(fixture, configId)).authorization_user_id).toBe(fixture.adminUserId)
      await withClient(async (client) => {
        const updated = await client.query(
          'update scim_tokens set created_by = null where id = $1 and sso_config_id = $2 and organization_id = $3 and tenant_id = $4',
          [legacyToken.tokenId, configId, fixture.organizationId, fixture.tenantId],
        )
        expect(updated.rowCount).toBe(1)
        const existingUsers = await client.query<{ count: number }>(
          'select count(*)::int as count from users where organization_id = $1 and tenant_id = $2 and deleted_at is null',
          [fixture.organizationId, fixture.tenantId],
        )
        expect(existingUsers.rows[0]?.count).toBe(originalUserCount)
      })
      expect((await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', legacyToken.rawToken, payload)).status()).toBe(403)
      const replacement = await issueToken(request, fixture, configId)
      const provisioned = await scimRequest(request, 'POST', '/api/sso/scim/v2/Users', replacement.rawToken, payload)
      expect(provisioned.status()).toBe(201)
      const identityId = (await readJsonSafe<{ id: string }>(provisioned))?.id
      expect(identityId).toBeTruthy()
      await withClient(async (client) => {
        const identities = await client.query<{ user_id: string }>(
          'select user_id from sso_identities where id = $1 and sso_config_id = $2 and organization_id = $3 and tenant_id = $4',
          [identityId, configId, fixture.organizationId, fixture.tenantId],
        )
        expect(identities.rows).toHaveLength(1)
        fixture.userIds.push(identities.rows[0].user_id)
      })
    })
  })
})
