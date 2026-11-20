import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/helpers/integration/auth'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createSuperadminApiToken, enrollTotp, fetchJson, generateTotpCode, loginViaApi } from './securityFixtures'

export type SudoTestContext = {
  token: string
  password: string
  userId: string
  tenantId: string
  organizationId: string
}

export type SudoChallengeResponse = {
  required?: boolean
  sessionId?: string
  method?: string
}

export type SudoVerifyResponse = {
  sudoToken?: string
  expiresAt?: string
  error?: string
}

export type SudoSessionRecord = {
  sessionToken: string
  verifiedAt: Date | null
  targetIdentifier: string | null
  sudoConfigId: string | null
  sudoConfigUpdatedAt: Date | null
}

export async function createSudoTestContext(request: APIRequestContext): Promise<SudoTestContext> {
  const token = await createSuperadminApiToken(request)
  const { userId, tenantId, organizationId } = getTokenScope(token)
  expect(userId, 'shared superadmin fixture should include a user id').not.toBe('')
  expect(tenantId, 'shared superadmin fixture should include a tenant id').not.toBe('')
  expect(organizationId, 'shared superadmin fixture should include an organization id').not.toBe('')
  return {
    token,
    password: DEFAULT_CREDENTIALS.superadmin.password,
    userId,
    tenantId,
    organizationId,
  }
}

export function buildSudoScopeCookie(tenantId: string, organizationId: string | null): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

export async function createPasswordSudoConfig(input: {
  targetIdentifier: string
  tenantId: string
  organizationId: string | null
  configuredBy: string
}): Promise<string> {
  const configId = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into sudo_challenge_configs (
         id, tenant_id, organization_id, label, target_identifier, is_enabled,
         is_developer_default, ttl_seconds, challenge_method, configured_by,
         created_at, updated_at
       ) values ($1, $2, $3, $4, $5, true, false, 300, 'password', $6, now(), now())`,
      [
        configId,
        input.tenantId,
        input.organizationId,
        `Integration fixture for ${input.targetIdentifier}`,
        input.targetIdentifier,
        input.configuredBy,
      ],
    )
  })
  return configId
}

export async function insertLegacyUnboundSudoSession(input: {
  userId: string
  tenantId: string
}): Promise<string> {
  const sessionId = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into sudo_sessions (
         id, user_id, tenant_id, session_token, challenge_method,
         expires_at, verified_at, created_at
       ) values ($1, $2, $3, $4, 'password', now() + interval '5 minutes', null, now())`,
      [sessionId, input.userId, input.tenantId, randomUUID()],
    )
  })
  return sessionId
}

export async function initiateSudoChallenge(
  request: APIRequestContext,
  input: { token: string; targetIdentifier: string; cookie?: string },
) {
  return fetchJson<SudoChallengeResponse>(request, 'POST', '/api/security/sudo', {
    token: input.token,
    headers: input.cookie ? { Cookie: input.cookie } : undefined,
    data: { targetIdentifier: input.targetIdentifier },
  })
}

export async function verifySudoChallenge(
  request: APIRequestContext,
  input: {
    token: string
    sessionId: string
    targetIdentifier: string
    password: string
    cookie?: string
  },
) {
  return fetchJson<SudoVerifyResponse>(request, 'POST', '/api/security/sudo/verify', {
    token: input.token,
    headers: input.cookie ? { Cookie: input.cookie } : undefined,
    data: {
      sessionId: input.sessionId,
      targetIdentifier: input.targetIdentifier,
      methodType: 'password',
      payload: { password: input.password },
    },
  })
}

export async function readSudoSession(sessionId: string): Promise<SudoSessionRecord | null> {
  return withClient(async (client) => {
    const result = await client.query<SudoSessionRecord>(
      `select
         session_token as "sessionToken",
         verified_at as "verifiedAt",
         target_identifier as "targetIdentifier",
         sudo_config_id as "sudoConfigId",
         sudo_config_updated_at as "sudoConfigUpdatedAt"
       from sudo_sessions
       where id = $1`,
      [sessionId],
    )
    return result.rows[0] ?? null
  })
}

export async function deleteSudoFixtures(input: {
  configIds?: string[]
  sessionIds?: string[]
}): Promise<void> {
  await withClient(async (client) => {
    if (input.sessionIds?.length) {
      await client.query('delete from sudo_sessions where id = any($1::uuid[])', [input.sessionIds])
    }
    if (input.configIds?.length) {
      await client.query('delete from sudo_challenge_configs where id = any($1::uuid[])', [input.configIds])
    }
  })
}

export async function createIsolatedMfaSudoFixture(request: APIRequestContext) {
  const bootstrapToken = await createSuperadminApiToken(request)
  const { tenantId } = getTokenScope(bootstrapToken)
  const stamp = randomUUID()
  const password = `Sudo1!${stamp}`
  let organizationId: string | null = null
  let roleId: string | null = null
  const userIds: string[] = []
  const configIds: string[] = []
  const cleanup = async (cleanupRequest = request) => {
    await withClient(async (client) => {
      if (userIds.length) {
        await client.query('delete from sudo_sessions where user_id = any($1::uuid[])', [userIds])
        await client.query('delete from mfa_challenges where user_id = any($1::uuid[])', [userIds])
        await client.query('delete from mfa_recovery_codes where user_id = any($1::uuid[])', [userIds])
        await client.query('delete from user_mfa_methods where user_id = any($1::uuid[])', [userIds])
      }
      if (configIds.length) {
        await client.query('delete from sudo_challenge_configs where id = any($1::uuid[])', [configIds])
      }
    })
    for (const userId of userIds) await deleteUserIfExists(cleanupRequest, bootstrapToken, userId)
    await deleteRoleIfExists(cleanupRequest, bootstrapToken, roleId)
    await deleteOrganizationIfExists(cleanupRequest, bootstrapToken, organizationId)
  }

  try {
    organizationId = await createOrganizationFixture(request, bootstrapToken, { name: `Sudo ${stamp}`, tenantId })
    roleId = await createRoleFixture(request, bootstrapToken, { name: `Sudo ${stamp}`, tenantId })
    await setRoleAclFeatures(request, bootstrapToken, { roleId, features: ['security.*'], organizations: [organizationId] })
    const users: Array<{ id: string; token: string }> = []
    for (const label of ['actor', 'target', 'control']) {
      const email = `sudo-${label}-${stamp}@acme.com`
      const userId = await createUserFixture(request, bootstrapToken, {
        email, password, organizationId, roles: [roleId],
      })
      userIds.push(userId)
      const login = await loginViaApi(request, email, password)
      users.push({ id: userId, token: login.token })
    }
    const [actor, target, control] = users
    const enrollment = await enrollTotp(request, actor.token)
    for (const targetIdentifier of ['security.sudo.manage', 'security.admin.mfa.reset']) {
      const configId = randomUUID()
      configIds.push(configId)
      await withClient(async (client) => {
        await client.query(
          `insert into sudo_challenge_configs (
             id, tenant_id, organization_id, label, target_identifier, is_enabled,
             is_developer_default, ttl_seconds, challenge_method, configured_by, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, true, false, 300, 'mfa', $6, now(), now())`,
          [configId, tenantId, organizationId, `Sudo ${stamp}`, targetIdentifier, actor.id],
        )
      })
    }
    return { token: actor.token, secret: enrollment.secret, target, control, resetConfigId: configIds[1], cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export async function verifyTotpSudoChallenge(
  request: APIRequestContext,
  input: { token: string; secret: string; targetIdentifier: string },
): Promise<SudoVerifyResponse> {
  const initiated = await initiateSudoChallenge(request, input)
  expect(initiated.status).toBe(200)
  expect(initiated.body.required).toBe(true)
  expect(initiated.body.method).toBe('mfa')
  expect(initiated.body.sessionId).toBeTruthy()
  const prepared = await fetchJson(request, 'POST', '/api/security/sudo/prepare', {
    token: input.token,
    data: { sessionId: initiated.body.sessionId, methodType: 'totp' },
  })
  expect(prepared.status).toBe(200)
  const verified = await fetchJson<SudoVerifyResponse>(request, 'POST', '/api/security/sudo/verify', {
    token: input.token,
    data: {
      sessionId: initiated.body.sessionId,
      targetIdentifier: input.targetIdentifier,
      methodType: 'totp',
      payload: { code: generateTotpCode(input.secret) },
    },
  })
  expect(verified.status).toBe(200)
  expect(verified.body.sudoToken).toBeTruthy()
  expect(verified.body.expiresAt).toBeTruthy()
  return verified.body
}
