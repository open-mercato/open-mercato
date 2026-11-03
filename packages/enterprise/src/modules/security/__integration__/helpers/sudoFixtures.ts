import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/helpers/integration/auth'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSuperadminApiToken, fetchJson } from './securityFixtures'

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
