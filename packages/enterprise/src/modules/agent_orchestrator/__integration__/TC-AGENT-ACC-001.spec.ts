import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  AGENT_RUN_FEATURE,
  AGENTS_LIST_PATH,
  GATED_AGENT_FEATURE,
  GATED_AGENT_ID,
  GATED_AGENT_INPUT,
  INVOKE_DENIED_CODE,
  agentRunPath,
  createScopedAgentUser,
  createScopedApiKey,
  deleteScopedAgentUser,
  deleteScopedApiKey,
  type ScopedAgentUser,
  type ScopedApiKey,
} from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-ACC-001: per-agent invoke permission on the run route and the agent list.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Integration: `POST /agents/:id/run`, `GET /agents`).
 *
 * No model call is needed: the invoke check runs in `AgentRuntimeService.run()`
 * after the registry lookup and before admission, so a denied caller gets the
 * 403 before any provider is touched. The gated agent is `support.ticket_triage`
 * (`requiredFeatures: ['agent_orchestrator.agents.view']`); the caller holds
 * `agent_orchestrator.agents.run` only.
 *
 * Environment limit: `GET /agents` itself requires `agent_orchestrator.agents.view`
 * — the very feature the only feature-gated example agent declares — so a listing
 * caller can always invoke it and "hidden from a non-invoker" has no deterministic
 * fixture. The list case asserts the additive `invocable` field instead, that a
 * non-manager never receives `requiredFeatures`, and that a manager (admin) does. Assumes the default `OM_AGENT_INVOKE_ENFORCEMENT` (on).
 *
 * Self-contained: creates its own roles, user and API key; deletes them in `finally`.
 */

type InvokeDeniedBody = { error?: string; code?: string; agentId?: string }
type AgentListItem = { id?: string; requiredFeatures?: unknown; invocable?: unknown }

test.describe('TC-AGENT-ACC-001: per-agent invoke permission', () => {
  test('a user without the agent feature is denied with agent_invoke_denied', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let caller: ScopedAgentUser | null = null
    try {
      caller = await createScopedAgentUser(request, adminToken, { label: 'run-only', features: [AGENT_RUN_FEATURE] })

      const response = await apiRequest(request, 'POST', agentRunPath(GATED_AGENT_ID), {
        token: caller.token,
        data: { input: GATED_AGENT_INPUT },
      })
      const raw = await response.text()
      expect(response.status(), raw).toBe(403)
      const body = JSON.parse(raw) as InvokeDeniedBody
      expect(body.code).toBe(INVOKE_DENIED_CODE)
      expect(body.agentId).toBe(GATED_AGENT_ID)
      expect(raw, 'the agent required features are never echoed').not.toContain(GATED_AGENT_FEATURE)
    } finally {
      await deleteScopedAgentUser(request, adminToken, caller)
    }
  })

  test('an API key whose role lacks the agent feature is denied the same way', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let apiKey: ScopedApiKey | null = null
    try {
      apiKey = await createScopedApiKey(request, adminToken, { label: 'key-run-only', features: [AGENT_RUN_FEATURE] })

      const response = await request.fetch(agentRunPath(GATED_AGENT_ID), {
        method: 'POST',
        headers: { 'x-api-key': apiKey.secret, 'Content-Type': 'application/json' },
        data: JSON.stringify({ input: GATED_AGENT_INPUT }),
      })
      const raw = await response.text()
      expect(response.status(), raw).toBe(403)
      const body = JSON.parse(raw) as InvokeDeniedBody
      expect(body.code).toBe(INVOKE_DENIED_CODE)
      expect(raw).not.toContain(GATED_AGENT_FEATURE)
    } finally {
      await deleteScopedApiKey(request, adminToken, apiKey)
    }
  })

  test('the agent list reports invocable for an invoker and requiredFeatures only to a manager', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let viewer: ScopedAgentUser | null = null
    try {
      viewer = await createScopedAgentUser(request, adminToken, {
        label: 'viewer',
        features: [GATED_AGENT_FEATURE, AGENT_RUN_FEATURE],
      })

      const response = await apiRequest(request, 'GET', AGENTS_LIST_PATH, { token: viewer.token })
      expect(response.status(), await response.text()).toBe(200)
      const body = await readJsonSafe<{ items?: AgentListItem[] }>(response)
      const items = body?.items ?? []
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.requiredFeatures, `${String(item.id)} never echoes requiredFeatures to a non-manager`).toBeUndefined()
        expect(item.invocable, `${String(item.id)} is listed for a non-manager only when invocable`).toBe(true)
      }
      const gated = items.find((item) => item.id === GATED_AGENT_ID)
      expect(gated, `${GATED_AGENT_ID} is visible to a caller holding its feature`).toBeTruthy()

      const managerResponse = await apiRequest(request, 'GET', AGENTS_LIST_PATH, { token: adminToken })
      expect(managerResponse.status(), await managerResponse.text()).toBe(200)
      const managerBody = await readJsonSafe<{ items?: AgentListItem[] }>(managerResponse)
      const managerGated = (managerBody?.items ?? []).find((item) => item.id === GATED_AGENT_ID)
      expect(managerGated?.requiredFeatures).toEqual([GATED_AGENT_FEATURE])
    } finally {
      await deleteScopedAgentUser(request, adminToken, viewer)
    }
  })
})
