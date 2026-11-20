import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import { FIXTURE_PASSWORD, agentRunPath, uniqueStamp } from './helpers/agentAccessFixtures'
import { deleteAgentPrincipalRows, insertAgentPrincipalRow } from './helpers/agentIdentityFixtures'
import {
  POLICY_CHECK_AGENT_ID,
  POLICY_CHECK_INPUT,
  POLICY_CHECK_REQUIRED_FEATURE,
} from './helpers/integrityFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'

/**
 * TC-AGENT-ACC-013: a principal-bound run still writes its runtime-audit rows after
 * the same app process has server-rendered a backoffice page (#9648, B-14).
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (no-bypass guard, runtime-audit allowlist).
 *
 * A production build loads the agent_orchestrator modules twice (route-handler
 * and SSR chunk graphs). Before the fix, a run bound to an enabled principal
 * failed with `AgentWriteBypassError (entity=AgentGuardrailCheck)` as soon as
 * any backoffice page had been rendered, because the runtime-audit allowlist
 * matched entity classes by object identity and the write scopes lived in
 * module-local state. Run this against a production build
 * (`yarn test:integration:ephemeral:start`) to exercise the two chunk graphs.
 *
 * `support.policy_check` declares integrity rules, so a completed run persists
 * `agent_guardrail_checks` rows under the agent actor. The principal is an
 * enabled `agent_principals` row (no public creation API; same precedent as
 * TC-AGENT-ACC-009) for a fresh role/user created through the auth API.
 *
 * Model-dependent: without a usable provider the run answers 503 and the test
 * skips after the page render.
 *
 * Self-contained: the run, its trace rows, the principal row, user and role are
 * removed in `finally`.
 */

const BACKOFFICE_PAGE_PATH = '/backend/agents'

type RunBody = {
  runId?: unknown
  error?: string
  code?: string
  integrity?: { outcome?: unknown } | null
}

async function findLivePrincipalId(organizationId: string, agentId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'select id from agent_principals where organization_id = $1 and agent_definition_id = $2 and deleted_at is null limit 1',
      [organizationId, agentId],
    )
    return result.rows[0]?.id ?? null
  })
}

async function countGuardrailChecks(runId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from agent_guardrail_checks where agent_run_id = $1',
      [runId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

test.describe('TC-AGENT-ACC-013: principal-bound run after a server-rendered page', () => {
  test('writes runtime-audit rows under the agent actor once a backoffice page was rendered', async ({ request, baseURL }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    test.skip(!(await hasConfiguredLlmProvider(request, adminToken)), NO_LLM_PROVIDER_SKIP_REASON)
    test.skip(
      (await findLivePrincipalId(organizationId, POLICY_CHECK_AGENT_ID)) !== null,
      `${POLICY_CHECK_AGENT_ID} already has a live principal in this organization`,
    )

    const stamp = uniqueStamp()
    let roleId: string | null = null
    let userId: string | null = null
    let principalId: string | null = null
    const runIds: string[] = []
    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT agent principal ssr ${stamp}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [POLICY_CHECK_REQUIRED_FEATURE],
        organizations: null,
      })
      userId = await createUserFixture(request, adminToken, {
        email: `it-agent-principal-ssr-${stamp}@example.com`,
        password: FIXTURE_PASSWORD,
        organizationId,
        roles: [roleId],
      })
      principalId = await insertAgentPrincipalRow({
        tenantId,
        organizationId,
        userId,
        roleId,
        agentDefinitionId: POLICY_CHECK_AGENT_ID,
        credentialMode: 'internal',
      })

      const page = await request.fetch(BACKOFFICE_PAGE_PATH, {
        method: 'GET',
        headers: { Cookie: `auth_token=${adminToken}` },
        maxRedirects: 0,
      })
      expect(page.status(), `server render of ${BACKOFFICE_PAGE_PATH} via ${baseURL ?? 'baseURL'}`).toBe(200)
      expect(await page.text()).toContain('<html')

      const response = await apiRequest(request, 'POST', agentRunPath(POLICY_CHECK_AGENT_ID), {
        token: adminToken,
        data: { input: POLICY_CHECK_INPUT },
      })
      const body = await readJsonSafe<RunBody>(response)
      if (typeof body?.runId === 'string') runIds.push(body.runId)
      test.skip(isModelUnavailableResponse(response.status()), NO_LLM_PROVIDER_SKIP_REASON)

      expect(body?.code, JSON.stringify(body)).not.toBe('agent_write_bypass')
      expect(JSON.stringify(body ?? {})).not.toContain('AgentWriteBypassError')
      expect(response.status(), JSON.stringify(body)).toBe(200)
      expect(typeof body?.runId, 'runId').toBe('string')
      expect(body?.integrity, 'integrity summary from the persisted guardrail checks').toBeTruthy()
      expect(await countGuardrailChecks(body!.runId as string), 'guardrail check rows written under the agent actor').toBeGreaterThan(0)
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
      if (principalId) await deleteAgentPrincipalRows([principalId]).catch(() => undefined)
      await deleteUserIfExists(request, adminToken, userId).catch(() => undefined)
      await deleteRoleIfExists(request, adminToken, roleId).catch(() => undefined)
    }
  })
})
