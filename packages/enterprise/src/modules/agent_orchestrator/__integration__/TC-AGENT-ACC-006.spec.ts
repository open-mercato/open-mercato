import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsByIds, insertAgentRunFixtures } from './helpers/agentPerfFixtures'
import {
  AGENT_RUN_FEATURE,
  AGENTS_LIST_PATH,
  GATED_AGENT_FEATURE,
  GATED_AGENT_ID,
  INVOKE_DENIED_CODE,
  createScopedAgentUser,
  deleteScopedAgentUser,
  type ScopedAgentUser,
} from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-ACC-006: re-running a run is denied once the caller's invoke permission is revoked.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Integration: `POST /runs/:id/rerun` — denied after the feature is revoked from the role).
 *
 * No model needed: the invoke check runs in `AgentRuntimeService.run()` before
 * admission, so the revoked caller gets the 403 before any provider is touched.
 * The caller's role first holds `agent_orchestrator.agents.view` (the feature
 * `support.ticket_triage` requires) and the agent is listed as invocable for it;
 * the feature is then removed from the role through the ACL API and the re-run
 * of a run of that agent answers 403 `agent_invoke_denied`.
 *
 * The source run is seeded through dbFixtures (a real run needs a model); the
 * re-run of an allowed caller would execute the agent, so it is not exercised.
 *
 * Self-contained: creates its own role, user and run; deletes them in `finally`.
 */

type InvokeDeniedBody = { error?: string; code?: string; agentId?: string }
type AgentListItem = { id?: string; invocable?: unknown }

function rerunPath(runId: string): string {
  return `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/rerun`
}

test.describe('TC-AGENT-ACC-006: re-run after the invoke permission is revoked', () => {
  test('the re-run answers 403 agent_invoke_denied once the role loses the agent feature', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    let caller: ScopedAgentUser | null = null
    const runIds: string[] = []
    try {
      caller = await createScopedAgentUser(request, adminToken, {
        label: 'rerun-revoked',
        features: [GATED_AGENT_FEATURE, AGENT_RUN_FEATURE],
      })
      runIds.push(
        ...(await insertAgentRunFixtures([
          { tenantId, organizationId, agentId: GATED_AGENT_ID, createdAt: new Date() },
        ])),
      )
      const [runId] = runIds

      const before = await apiRequest(request, 'GET', AGENTS_LIST_PATH, { token: caller.token })
      expect(before.status(), await before.text()).toBe(200)
      const listed = ((await readJsonSafe<{ items?: AgentListItem[] }>(before))?.items ?? []).find(
        (item) => item.id === GATED_AGENT_ID,
      )
      expect(listed?.invocable, 'the caller may invoke the agent before the revocation').toBe(true)

      await setRoleAclFeatures(request, adminToken, {
        roleId: caller.roleId,
        features: [AGENT_RUN_FEATURE],
        organizations: null,
      })

      const response = await apiRequest(request, 'POST', rerunPath(runId), { token: caller.token })
      const raw = await response.text()
      expect(response.status(), raw).toBe(403)
      const body = JSON.parse(raw) as InvokeDeniedBody
      expect(body.code).toBe(INVOKE_DENIED_CODE)
      expect(body.agentId).toBe(GATED_AGENT_ID)
      expect(raw, 'the agent required features are never echoed').not.toContain(GATED_AGENT_FEATURE)
    } finally {
      await deleteScopedAgentUser(request, adminToken, caller)
      await deleteAgentRunsByIds(runIds).catch(() => undefined)
    }
  })
})
