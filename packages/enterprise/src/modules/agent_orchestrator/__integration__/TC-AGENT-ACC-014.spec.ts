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
 * TC-AGENT-ACC-014: a principal-bound native run records its trace spans (#9648, B-14 follow-up).
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (no-bypass guard, runtime-audit allowlist).
 *
 * Native trace capture writes the run's usage stamp on `agent_runs` and then the
 * spans and tool calls, under the agent actor and `withRuntimeAuditWrite`. The
 * tenant encryption subscriber re-encrypts `agent_runs.input` into every update
 * of the run before the no-bypass guard checks the changed fields, so the guard
 * rejected the usage stamp; the best-effort capture swallowed the error and the
 * run completed with 0 spans and 0 tool calls (an unbound run of the same agent
 * recorded them). Needs tenant data encryption on (the default).
 *
 * The principal is an enabled `agent_principals` row (no public creation API;
 * same precedent as TC-AGENT-ACC-009/013) for a fresh role/user created through
 * the auth API. Model-dependent: without a usable provider the run answers 503
 * and the test skips.
 *
 * Self-contained: the run, its trace rows, the principal row, user and role are
 * removed in `finally`.
 */

type RunBody = {
  runId?: unknown
  error?: string
  code?: string
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

async function countSpans(runId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from agent_spans where agent_run_id = $1',
      [runId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

test.describe('TC-AGENT-ACC-014: principal-bound run trace capture', () => {
  test('records the trace spans of a run bound to an enabled principal', async ({ request }) => {
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
      roleId = await createRoleFixture(request, adminToken, { name: `IT agent principal trace ${stamp}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [POLICY_CHECK_REQUIRED_FEATURE],
        organizations: null,
      })
      userId = await createUserFixture(request, adminToken, {
        email: `it-agent-principal-trace-${stamp}@example.com`,
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

      const response = await apiRequest(request, 'POST', agentRunPath(POLICY_CHECK_AGENT_ID), {
        token: adminToken,
        data: { input: POLICY_CHECK_INPUT },
      })
      const body = await readJsonSafe<RunBody>(response)
      if (typeof body?.runId === 'string') runIds.push(body.runId)
      test.skip(isModelUnavailableResponse(response.status()), NO_LLM_PROVIDER_SKIP_REASON)

      expect(response.status(), JSON.stringify(body)).toBe(200)
      expect(typeof body?.runId, 'runId').toBe('string')
      expect(await countSpans(body!.runId as string), 'trace spans written under the agent actor').toBeGreaterThan(0)
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
      if (principalId) await deleteAgentPrincipalRows([principalId]).catch(() => undefined)
      await deleteUserIfExists(request, adminToken, userId).catch(() => undefined)
      await deleteRoleIfExists(request, adminToken, roleId).catch(() => undefined)
    }
  })
})
