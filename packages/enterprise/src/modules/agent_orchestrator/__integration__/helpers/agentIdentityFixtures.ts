import { expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { FIXTURE_PASSWORD, uniqueStamp } from './agentAccessFixtures'

/**
 * Fixtures for the agent identity specs (TC-AGENT-ACC-009, TC-AGENT-ACC-010).
 *
 * External (`oauth_client`) agent principals, their client secrets and their
 * delegation grants have no public creation API — they are provisioned by
 * services (`provisionAgentClientSecret`, `createAgentDelegationGrant`) that only
 * server code calls. The specs therefore build them from public pieces plus the
 * shared dbFixtures client (same precedent and DATABASE_URL caveat as
 * agentPerfFixtures.ts):
 *   - the principal's role and user come from the auth API;
 *   - the client secret is a real API key created through `POST /api/api_keys/keys`
 *     (so the secret is hashed by the product), then re-labelled with the
 *     `__agent_oauth_client__<principalId>__` marker and the principal user as
 *     creator — exactly the row `provisionAgentClientSecret` writes;
 *   - the `agent_principals` and `agent_delegation_grants` rows are inserted directly.
 * Every created id is returned so the caller removes it in `finally`.
 */

export const OAUTH_TOKEN_PATH = '/api/agent_orchestrator/identity/token'
export const AGENT_API_RUN_SCOPE = 'agent_orchestrator.agents.run'

export type ExternalAgentClient = {
  principalId: string
  userId: string
  roleId: string
  apiKeyId: string
  clientSecret: string
  grantId: string
}

export type ExternalAgentClientCleanup = {
  principalId: string | null
  userId: string | null
  roleId: string | null
  apiKeyId: string | null
}

function clientSecretKeyName(principalId: string): string {
  return `__agent_oauth_client__${principalId}__`
}

export async function insertAgentPrincipalRow(input: {
  tenantId: string
  organizationId: string
  userId: string
  roleId: string
  agentDefinitionId: string
  credentialMode: 'internal' | 'oauth_client'
}): Promise<string> {
  const id = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into agent_principals (
         id, tenant_id, organization_id, user_id, agent_definition_id, role_id,
         credential_mode, enabled, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, true, now(), now())`,
      [id, input.tenantId, input.organizationId, input.userId, input.agentDefinitionId, input.roleId, input.credentialMode],
    )
  })
  return id
}

export async function insertDelegationGrantRow(input: {
  tenantId: string
  organizationId: string
  principalId: string
  agentUserId: string
  scopes: string[]
  expiresAt?: Date | null
}): Promise<string> {
  const id = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into agent_delegation_grants (
         id, tenant_id, organization_id, agent_principal_id, agent_user_id, delegator_user_id,
         scopes, expires_at, revoked_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, null, $6::jsonb, $7, null, now(), now())`,
      [
        id,
        input.tenantId,
        input.organizationId,
        input.principalId,
        input.agentUserId,
        JSON.stringify(input.scopes),
        input.expiresAt ?? null,
      ],
    )
  })
  return id
}

export async function expireDelegationGrant(grantId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update agent_delegation_grants set expires_at = now() - interval '1 minute', updated_at = now() where id = $1`,
      [grantId],
    )
  })
}

export async function deleteAgentPrincipalRows(principalIds: string[]): Promise<void> {
  if (!principalIds.length) return
  await withClient(async (client) => {
    await client.query('delete from agent_delegation_grants where agent_principal_id = any($1::uuid[])', [principalIds])
    await client.query('delete from agent_principals where id = any($1::uuid[])', [principalIds])
  })
}

async function deleteApiKeyRow(apiKeyId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from api_keys where id = $1', [apiKeyId])
  })
}

/**
 * Provisions an external agent client: a role holding `roleFeatures`, the
 * principal's user, an `oauth_client` principal, its client secret and one
 * delegation grant with `scopes`. The principal's `agent_definition_id` is unique
 * per call, so it never collides with a declared agent's principal.
 */
export async function createExternalAgentClient(
  request: APIRequestContext,
  adminToken: string,
  scope: { tenantId: string; organizationId: string },
  input: { label: string; roleFeatures: string[]; scopes: string[] },
): Promise<ExternalAgentClient> {
  const stamp = uniqueStamp()
  let roleId: string | null = null
  let userId: string | null = null
  let apiKeyId: string | null = null
  let principalId: string | null = null
  try {
    roleId = await createRoleFixture(request, adminToken, { name: `IT agent client ${input.label} ${stamp}` })
    await setRoleAclFeatures(request, adminToken, { roleId, features: input.roleFeatures, organizations: null })
    userId = await createUserFixture(request, adminToken, {
      email: `it-agent-client-${input.label}-${stamp}@example.com`,
      password: FIXTURE_PASSWORD,
      organizationId: scope.organizationId,
      roles: [roleId],
    })

    principalId = await insertAgentPrincipalRow({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId,
      roleId,
      agentDefinitionId: `it-agent-client-${stamp}`,
      credentialMode: 'oauth_client',
    })

    const keyResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
      token: adminToken,
      data: { name: `it-agent-client-${input.label}-${stamp}`, roles: [], organizationId: scope.organizationId },
    })
    const keyBody = await readJsonSafe<{ id?: string; secret?: string }>(keyResponse)
    expect(keyResponse.ok(), `client secret API key creation failed: ${keyResponse.status()}`).toBeTruthy()
    if (typeof keyBody?.id !== 'string' || typeof keyBody?.secret !== 'string') {
      throw new Error('[internal] API key fixture response is missing id or secret')
    }
    apiKeyId = keyBody.id
    const createdKeyId = keyBody.id
    const ownerUserId = userId
    const ownerPrincipalId = principalId
    await withClient(async (client) => {
      await client.query('update api_keys set name = $1, created_by = $2, roles_json = $3::jsonb where id = $4', [
        clientSecretKeyName(ownerPrincipalId),
        ownerUserId,
        JSON.stringify([]),
        createdKeyId,
      ])
    })

    const grantId = await insertDelegationGrantRow({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      principalId,
      agentUserId: userId,
      scopes: input.scopes,
    })
    return { principalId, userId, roleId, apiKeyId, clientSecret: keyBody.secret, grantId }
  } catch (error) {
    await deleteExternalAgentClient(request, adminToken, {
      principalId,
      userId,
      roleId,
      apiKeyId,
    }).catch(() => undefined)
    throw error
  }
}

export async function deleteExternalAgentClient(
  request: APIRequestContext,
  adminToken: string | null,
  fixture: ExternalAgentClientCleanup | null,
): Promise<void> {
  if (!fixture) return
  if (fixture.principalId) await deleteAgentPrincipalRows([fixture.principalId]).catch(() => undefined)
  if (fixture.apiKeyId) await deleteApiKeyRow(fixture.apiKeyId).catch(() => undefined)
  await deleteUserIfExists(request, adminToken, fixture.userId ?? null)
  await deleteRoleIfExists(request, adminToken, fixture.roleId ?? null)
}

export type MintedAgentToken = { status: number; accessToken: string | null; scope: string | null }

/** Client-credentials grant against the public token route. */
export async function mintAgentToken(
  request: APIRequestContext,
  client: Pick<ExternalAgentClient, 'principalId' | 'clientSecret'>,
  requestedScope?: string,
): Promise<MintedAgentToken> {
  const response = await request.fetch(OAUTH_TOKEN_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: client.principalId,
      client_secret: client.clientSecret,
      ...(requestedScope ? { scope: requestedScope } : {}),
    }),
  })
  const body = await readJsonSafe<{ access_token?: string; scope?: string }>(response)
  return {
    status: response.status(),
    accessToken: typeof body?.access_token === 'string' ? body.access_token : null,
    scope: typeof body?.scope === 'string' ? body.scope : null,
  }
}
