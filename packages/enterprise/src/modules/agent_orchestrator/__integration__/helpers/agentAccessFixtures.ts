import { expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Fixtures for the per-agent invoke access specs (TC-AGENT-ACC-*, TC-AO-MCP-DISPATCH-*).
 * Everything is created through public APIs and removed in the caller's `finally`.
 *
 * The feature-gated agent is `support.ticket_triage` from the `agent_examples`
 * app module, which is registered together with `agent_orchestrator` and declares
 * `requiredFeatures: ['agent_orchestrator.agents.view']`. A role holding
 * `agent_orchestrator.agents.run` WITHOUT `agent_orchestrator.agents.view` passes
 * the run route guard (`dependsOn` is advisory, not enforced) but cannot invoke
 * that agent — the denial runs before admission, so no model is needed.
 */

export const GATED_AGENT_ID = 'support.ticket_triage'
export const GATED_AGENT_FEATURE = 'agent_orchestrator.agents.view'
export const GATED_AGENT_TOOL = 'agent_examples.triage_ticket'
export const GATED_AGENT_INPUT = {
  subject: 'Charged twice this month',
  body: 'I was billed for two subscriptions this month but I only have one account. Please refund the duplicate charge.',
}
export const AGENT_RUN_FEATURE = 'agent_orchestrator.agents.run'
export const AGENTS_LIST_PATH = '/api/agent_orchestrator/agents'
export const RUN_OBJECT_PATH = '/api/ai_assistant/ai/run-object'
export const TOOLS_EXECUTE_PATH = '/api/ai_assistant/tools/execute'
export const CORRELATION_ID_HEADER = 'x-correlation-id'
export const INVOKE_DENIED_CODE = 'agent_invoke_denied'
export const FIXTURE_PASSWORD = 'AgentAccess!2345'
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ScopedAgentUser = {
  userId: string
  roleId: string
  token: string
}

export type ScopedApiKey = {
  apiKeyId: string
  roleId: string
  secret: string
}

export function uniqueStamp(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

export function agentRunPath(agentId: string): string {
  return `/api/agent_orchestrator/agents/${encodeURIComponent(agentId)}/run`
}

export function agentApiRunPath(agentId: string): string {
  return `/api/agent_orchestrator/agent-api/agents/${encodeURIComponent(agentId)}/run`
}

async function createFeatureRole(
  request: APIRequestContext,
  adminToken: string,
  label: string,
  features: string[],
): Promise<string> {
  const roleId = await createRoleFixture(request, adminToken, { name: `IT agent access ${label} ${uniqueStamp()}` })
  await setRoleAclFeatures(request, adminToken, { roleId, features, organizations: null })
  return roleId
}

export async function createScopedAgentUser(
  request: APIRequestContext,
  adminToken: string,
  input: { label: string; features: string[] },
): Promise<ScopedAgentUser> {
  const { organizationId } = getTokenScope(adminToken)
  const email = `it-agent-acc-${input.label}-${uniqueStamp()}@example.com`
  const roleId = await createFeatureRole(request, adminToken, input.label, input.features)
  try {
    const userId = await createUserFixture(request, adminToken, {
      email,
      password: FIXTURE_PASSWORD,
      organizationId,
      roles: [roleId],
    })
    const token = await getAuthToken(request, email, FIXTURE_PASSWORD)
    return { userId, roleId, token }
  } catch (error) {
    await deleteRoleIfExists(request, adminToken, roleId)
    throw error
  }
}

export async function deleteScopedAgentUser(
  request: APIRequestContext,
  adminToken: string | null,
  fixture: ScopedAgentUser | null,
): Promise<void> {
  if (!fixture) return
  await deleteUserIfExists(request, adminToken, fixture.userId)
  await deleteRoleIfExists(request, adminToken, fixture.roleId)
}

export async function createScopedApiKey(
  request: APIRequestContext,
  adminToken: string,
  input: { label: string; features: string[] },
): Promise<ScopedApiKey> {
  const { organizationId } = getTokenScope(adminToken)
  const roleId = await createFeatureRole(request, adminToken, input.label, input.features)
  const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
    token: adminToken,
    data: { name: `it-agent-acc-${input.label}-${uniqueStamp()}`, roles: [roleId], organizationId },
  })
  const body = await readJsonSafe<{ id?: string; secret?: string }>(response)
  if (!response.ok() || typeof body?.id !== 'string' || typeof body?.secret !== 'string') {
    await deleteRoleIfExists(request, adminToken, roleId)
    expect(response.ok(), `API key fixture creation failed: ${response.status()}`).toBeTruthy()
    throw new Error('[internal] API key fixture response is missing id or secret')
  }
  return { apiKeyId: body.id, roleId, secret: body.secret }
}

export async function deleteScopedApiKey(
  request: APIRequestContext,
  adminToken: string | null,
  fixture: ScopedApiKey | null,
): Promise<void> {
  if (!fixture || !adminToken) return
  await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(fixture.apiKeyId)}`, {
    token: adminToken,
  }).catch(() => undefined)
  await deleteRoleIfExists(request, adminToken, fixture.roleId)
}
