import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  AGENT_RUN_FEATURE,
  AGENTS_LIST_PATH,
  GATED_AGENT_FEATURE,
  GATED_AGENT_ID,
  createScopedAgentUser,
  deleteScopedAgentUser,
  type ScopedAgentUser,
} from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-ACC-004: the agent principal summary on the agents API, and the public OAuth token route.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Phases 2–4; Integration: `GET /agents`, `GET /agents/:id`, `POST /identity/token`).
 *
 * No model needed:
 *   - a caller holding `agent_orchestrator.agents.manage` (admin) receives a
 *     `principal` key on every agent of `GET /agents` and on `GET /agents/:id`
 *     (null when the agent declares and has no principal, otherwise the summary);
 *   - a non-manager never receives the key on either route;
 *   - `POST /identity/token` is reachable without a staff session: bad client
 *     credentials get the handler's minimal `{ error: 'invalid_client' }` 401
 *     (not the dispatcher's unauthenticated 401), a malformed grant its 400.
 *
 * Model-dependent and environment-dependent paths are covered by unit tests:
 * no registered example agent declares a principal, so runAs attribution of a
 * real run (`native-run-under-runas`) and the `OM_AGENT_TOOL_ACL_MODE=intersect`
 * deny (`effective-tool-acl`, read from the APP process env) have no
 * deterministic fixture here.
 *
 * Self-contained: creates its own role and user; deletes them in `finally`.
 * The token route creates nothing.
 */

const OAUTH_TOKEN_PATH = '/api/agent_orchestrator/identity/token'

type PrincipalSummary = {
  declared?: unknown
  provisioned?: unknown
  enabled?: unknown
  toolAcl?: unknown
  required?: unknown
}
type AgentListItem = { id?: string } & Record<string, unknown>
type OAuthErrorBody = { error?: string }

function expectPrincipalShape(value: unknown, label: string): void {
  if (value === null) return
  const summary = value as PrincipalSummary
  expect(typeof summary.declared, `${label} principal.declared`).toBe('boolean')
  expect(typeof summary.provisioned, `${label} principal.provisioned`).toBe('boolean')
  expect(typeof summary.enabled, `${label} principal.enabled`).toBe('boolean')
  expect(['caller', 'intersect'], `${label} principal.toolAcl`).toContain(summary.toolAcl)
  expect(typeof summary.required, `${label} principal.required`).toBe('boolean')
}

function agentDetailPath(agentId: string): string {
  return `${AGENTS_LIST_PATH}/${encodeURIComponent(agentId)}`
}

test.describe('TC-AGENT-ACC-004: agent principal summary and public token route', () => {
  test('a manager receives the principal summary and a non-manager never does', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let viewer: ScopedAgentUser | null = null
    try {
      const managerList = await apiRequest(request, 'GET', AGENTS_LIST_PATH, { token: adminToken })
      expect(managerList.status(), await managerList.text()).toBe(200)
      const managerItems = (await readJsonSafe<{ items?: AgentListItem[] }>(managerList))?.items ?? []
      expect(managerItems.length).toBeGreaterThan(0)
      for (const item of managerItems) {
        expect(item, `${String(item.id)} carries principal for a manager`).toHaveProperty('principal')
        expectPrincipalShape(item.principal, String(item.id))
      }

      const managerDetail = await apiRequest(request, 'GET', agentDetailPath(GATED_AGENT_ID), { token: adminToken })
      expect(managerDetail.status(), await managerDetail.text()).toBe(200)
      const managerDetailBody = await readJsonSafe<Record<string, unknown>>(managerDetail)
      expect(managerDetailBody).toHaveProperty('principal')
      expectPrincipalShape(managerDetailBody?.principal, GATED_AGENT_ID)

      viewer = await createScopedAgentUser(request, adminToken, {
        label: 'principal-viewer',
        features: [GATED_AGENT_FEATURE, AGENT_RUN_FEATURE],
      })

      const viewerList = await apiRequest(request, 'GET', AGENTS_LIST_PATH, { token: viewer.token })
      expect(viewerList.status(), await viewerList.text()).toBe(200)
      const viewerItems = (await readJsonSafe<{ items?: AgentListItem[] }>(viewerList))?.items ?? []
      expect(viewerItems.length).toBeGreaterThan(0)
      for (const item of viewerItems) {
        expect(item, `${String(item.id)} never carries principal for a non-manager`).not.toHaveProperty('principal')
      }

      const viewerDetail = await apiRequest(request, 'GET', agentDetailPath(GATED_AGENT_ID), { token: viewer.token })
      expect(viewerDetail.status(), await viewerDetail.text()).toBe(200)
      expect(await readJsonSafe<Record<string, unknown>>(viewerDetail)).not.toHaveProperty('principal')
    } finally {
      await deleteScopedAgentUser(request, adminToken, viewer)
    }
  })

  test('the OAuth token route answers bad client credentials without a staff session', async ({ request }) => {
    const badCredentials = await request.fetch(OAUTH_TOKEN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: `it-agent-acc-004-${Date.now()}`,
        client_secret: 'not-a-real-client-secret',
      }),
    })
    const badBody = await readJsonSafe<OAuthErrorBody>(badCredentials)
    test.skip(badCredentials.status() === 429, 'the per-IP token rate limit is exhausted in this environment')
    expect(badCredentials.status(), JSON.stringify(badBody)).toBe(401)
    expect(badBody, 'the handler minimal error, never the dispatcher 401').toEqual({ error: 'invalid_client' })

    const badGrant = await request.fetch(OAUTH_TOKEN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ grant_type: 'password', client_id: 'x-client', client_secret: 'x-secret' }),
    })
    test.skip(badGrant.status() === 429, 'the per-IP token rate limit is exhausted in this environment')
    expect(badGrant.status()).toBe(400)
    expect(await readJsonSafe<OAuthErrorBody>(badGrant)).toEqual({ error: 'unsupported_grant_type' })
  })
})
