import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  AGENT_RUN_FEATURE,
  AGENTS_LIST_PATH,
  FIXTURE_PASSWORD,
  GATED_AGENT_FEATURE,
  GATED_AGENT_ID,
  uniqueStamp,
} from './helpers/agentAccessFixtures'
import { deleteAgentPrincipalRows, insertAgentPrincipalRow } from './helpers/agentIdentityFixtures'
import {
  AUDIT_VIEW_TENANT_FEATURE,
  RUN_ACTION_COMMAND_ID,
  TRACE_VIEW_FEATURE,
  deleteSeededRunActions,
  runActionsPath,
  seedRunWithActions,
  type SeededRunActions,
} from './helpers/runActionFixtures'

/**
 * TC-AGENT-ACC-009: agent runs and agent principals never cross tenants.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (Integration: Tenant isolation; Risks → Tenant & data isolation).
 *
 * A second tenant B (organization, role and user) is created through the
 * superadmin directory/auth APIs. The tenant-B user holds every agent feature the
 * probed routes require (`agents.view|run|manage`, `trace.view`,
 * `audit_logs.view_tenant`), so any refusal is tenant scoping, not RBAC.
 *   - a run of tenant A (with correlated action logs) is visible to tenant A's
 *     admin, and answers 404 to tenant B on `GET /runs/:id`, `GET /runs/:id/actions`
 *     and `POST /runs/:id/rerun` (so it can never be re-executed from tenant B);
 *   - an agent principal provisioned for `support.ticket_triage` in tenant B is
 *     reported `provisioned: true` to tenant B's manager and never changes the
 *     principal summary tenant A's manager receives.
 *
 * No model needed. The run, action logs and principal row are seeded through
 * dbFixtures (no public creation API); the run is the run-actions fixture.
 * Requires the superadmin password (`OM_INIT_SUPERADMIN_PASSWORD`) in the runner.
 *
 * Self-contained: removes every seeded row and created record in `finally`.
 */

const TENANT_B_FEATURES = [
  GATED_AGENT_FEATURE,
  AGENT_RUN_FEATURE,
  'agent_orchestrator.agents.manage',
  TRACE_VIEW_FEATURE,
  AUDIT_VIEW_TENANT_FEATURE,
]

type PrincipalSummary = { provisioned?: unknown } | null

function runPath(runId: string): string {
  return `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}`
}

async function readPrincipalSummary(
  request: APIRequestContext,
  token: string,
): Promise<PrincipalSummary | undefined> {
  const response = await apiRequest(request, 'GET', `${AGENTS_LIST_PATH}/${encodeURIComponent(GATED_AGENT_ID)}`, { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<{ principal?: PrincipalSummary }>(response)
  return body?.principal
}

test.describe('TC-AGENT-ACC-009: tenant isolation of agent runs and principals', () => {
  test('a tenant-B caller can neither read nor re-run a tenant-A run, and principals stay per tenant', async ({ request }) => {
    test.slow()
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const tenantA = getTokenScope(adminToken)
    expect(tenantA.tenantId, 'the admin token carries a tenant').toBeTruthy()
    expect(tenantA.organizationId, 'the admin token carries an organization').toBeTruthy()

    const stamp = uniqueStamp()
    let tenantBId: string | null = null
    let organizationBId: string | null = null
    let roleBId: string | null = null
    let userBId: string | null = null
    let seed: SeededRunActions | null = null
    const principalIds: string[] = []
    try {
      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA TC-AGENT-ACC-009 Tenant B ${stamp}` },
      })
      expect(tenantResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201)
      tenantBId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'tenant id')
      expect(tenantBId).not.toBe(tenantA.tenantId)
      organizationBId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AGENT-ACC-009 Org B ${stamp}`,
        tenantId: tenantBId,
      })
      roleBId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-agent-acc-009-${stamp}`,
        tenantId: tenantBId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: roleBId,
        features: TENANT_B_FEATURES,
        organizations: [organizationBId],
      })
      const emailB = `qa-tc-agent-acc-009-${stamp}@example.com`
      userBId = await createUserFixture(request, superadminToken, {
        email: emailB,
        password: FIXTURE_PASSWORD,
        organizationId: organizationBId,
        roles: [roleBId],
      })
      const tokenB = await getAuthToken(request, emailB, FIXTURE_PASSWORD)
      expect(getTokenScope(tokenB).tenantId).toBe(tenantBId)

      const seeded = await seedRunWithActions({ tenantId: tenantA.tenantId, organizationId: tenantA.organizationId })
      seed = seeded
      const runId = seeded.correlatedRunId

      const ownRun = await apiRequest(request, 'GET', runPath(runId), { token: adminToken })
      expect(ownRun.status(), 'tenant A reads its own run').toBe(200)
      const ownActions = await apiRequest(request, 'GET', runActionsPath(runId), { token: adminToken })
      expect(ownActions.status(), 'tenant A reads its own run actions').toBe(200)
      expect(await ownActions.text()).toContain(RUN_ACTION_COMMAND_ID)

      const foreignRun = await apiRequest(request, 'GET', runPath(runId), { token: tokenB })
      expect(foreignRun.status(), 'tenant B cannot read a tenant-A run').toBe(404)
      const foreignActions = await apiRequest(request, 'GET', runActionsPath(runId), { token: tokenB })
      expect(foreignActions.status(), 'tenant B cannot read a tenant-A run actions').toBe(404)
      expect(await foreignActions.text()).not.toContain(RUN_ACTION_COMMAND_ID)
      const foreignRerun = await apiRequest(request, 'POST', `${runPath(runId)}/rerun`, { token: tokenB })
      expect(foreignRerun.status(), 'tenant B cannot re-run a tenant-A run').toBe(404)

      const summaryABefore = await readPrincipalSummary(request, adminToken)
      const summaryBBefore = await readPrincipalSummary(request, tokenB)
      expect(summaryBBefore, 'a fresh tenant has no principal for the agent').toBeNull()

      principalIds.push(
        await insertAgentPrincipalRow({
          tenantId: tenantBId,
          organizationId: organizationBId,
          userId: userBId,
          roleId: roleBId,
          agentDefinitionId: GATED_AGENT_ID,
          credentialMode: 'internal',
        }),
      )

      const summaryB = await readPrincipalSummary(request, tokenB)
      expect(summaryB?.provisioned, 'tenant B sees its own principal').toBe(true)
      const summaryA = await readPrincipalSummary(request, adminToken)
      expect(summaryA, 'a tenant-B principal never shows up in tenant A').toEqual(summaryABefore)
    } finally {
      await deleteAgentPrincipalRows(principalIds).catch(() => undefined)
      if (seed) await deleteSeededRunActions(seed).catch(() => undefined)
      await deleteUserIfExists(request, superadminToken, userBId)
      await deleteRoleIfExists(request, superadminToken, roleBId)
      await deleteOrganizationIfExists(request, superadminToken, organizationBId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantBId)
    }
  })
})
