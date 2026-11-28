import { randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { firstRegisteredAgentId } from './helpers/evalReportFixtures'
import {
  deleteRegressionFixtures,
  emptyFixtureIds,
  insertEvalCase,
  insertSuiteRun,
  type RegressionScope,
} from './helpers/evalRegressionFixtures'

/**
 * TC-AGENT-EVAL-REGRESSION-002: tenant/organization scoping and the feature gate
 * of the regression dashboard API.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-11-17-eval-regression-dashboard.md
 * (API Contracts: "a run outside the caller organization is 404", "Gated by
 * agent_orchestrator.eval.manage").
 *
 * The same agent and dataset have completed suite runs in the caller's
 * organization, in a second organization of the same tenant and in a foreign
 * tenant. Compare must 404 whenever either side is out of scope, trend must list
 * only the caller's runs, and a user holding every eval feature except
 * eval.manage must get 403 from both endpoints.
 */

type TrendResponse = {
  points: Array<{ suiteRunId: string; agentVersions: Array<string | null> }>
  versions: Array<{ agentVersion: string | null; runCount: number }>
}

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const RESTRICTED_PASSWORD = 'StrongSecret123!'
const NON_MANAGE_FEATURES = [
  'agent_orchestrator.agents.view',
  'agent_orchestrator.eval.run',
  'agent_orchestrator.eval.export',
]
const LOCAL_VERSION = 'sha256:111111111111'
const FOREIGN_VERSION = 'sha256:999999999999'

function compareUrl(base: string, head: string): string {
  return `/api/agent_orchestrator/eval-runs/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`
}

function trendUrl(agentId: string, evalSetVersion: string): string {
  return `/api/agent_orchestrator/eval-runs/trend?agentDefinitionId=${encodeURIComponent(agentId)}&evalSetVersion=${encodeURIComponent(evalSetVersion)}`
}

test.describe('TC-AGENT-EVAL-REGRESSION-002: eval regression API scoping and access', () => {
  test('compare 404s and trend excludes runs of another organization or tenant; 403 without eval.manage', async ({
    request,
  }) => {
    test.slow()

    const adminToken = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const context = getTokenContext(adminToken)
    expect(context.tenantId, 'admin token must carry a tenant id').toBeTruthy()
    expect(context.organizationId, 'admin token must carry an organization id').toBeTruthy()
    const localScope: RegressionScope = { tenantId: context.tenantId!, organizationId: context.organizationId! }

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const agentId = await firstRegisteredAgentId(request, adminToken)
    const evalSetVersion = `qa-regression-scope-${stamp}`
    const ids = emptyFixtureIds()
    const restrictedEmail = `qa-tc-agent-eval-regression-002-${stamp}@example.com`
    let superadminToken: string | null = null
    let otherOrganizationId: string | null = null
    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null

    try {
      superadminToken = await getAuthToken(request, 'superadmin')
      otherOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA eval regression 002 other org ${stamp}`,
        tenantId: localScope.tenantId,
      })
      const otherOrgScope: RegressionScope = { tenantId: localScope.tenantId, organizationId: otherOrganizationId }
      const foreignTenantScope: RegressionScope = { tenantId: randomUUID(), organizationId: randomUUID() }

      const now = Date.now()
      const seedCompletedRun = async (scope: RegressionScope, agentVersion: string, hoursAgo: number, passed: boolean) => {
        const caseId = await insertEvalCase(scope, agentId, `qa-regression-scope-${stamp}-${hoursAgo}`, ids)
        return insertSuiteRun(scope, {
          agentDefinitionId: agentId,
          status: 'completed',
          passScore: passed ? 1 : 0,
          evalSetVersion,
          agentVersion,
          createdAt: new Date(now - hoursAgo * 60 * 60 * 1000),
          caseRuns: [{ caseId, status: passed ? 'passed' : 'failed', verdicts: { schema: passed } }],
        }, ids)
      }

      const localBaseId = await seedCompletedRun(localScope, LOCAL_VERSION, 6, true)
      const otherOrgRunId = await seedCompletedRun(otherOrgScope, FOREIGN_VERSION, 5, false)
      const foreignTenantRunId = await seedCompletedRun(foreignTenantScope, FOREIGN_VERSION, 4, false)
      const localHeadId = await seedCompletedRun(localScope, LOCAL_VERSION, 3, true)
      const otherOrgSecondRunId = await seedCompletedRun(otherOrgScope, FOREIGN_VERSION, 2, true)

      const ownCompare = await apiRequest(request, 'GET', compareUrl(localBaseId, localHeadId), { token: adminToken })
      expect(ownCompare.status(), await ownCompare.text()).toBe(200)

      const outOfScopePairs: Array<[string, string, string]> = [
        [localBaseId, otherOrgRunId, 'head in another organization'],
        [otherOrgRunId, localHeadId, 'base in another organization'],
        [localBaseId, foreignTenantRunId, 'head in another tenant'],
        [foreignTenantRunId, localHeadId, 'base in another tenant'],
        [otherOrgRunId, otherOrgSecondRunId, 'both runs in another organization'],
      ]
      for (const [base, head, label] of outOfScopePairs) {
        const response = await apiRequest(request, 'GET', compareUrl(base, head), { token: adminToken })
        expect(response.status(), `${label} must be indistinguishable from a missing run`).toBe(404)
        expect((await readJsonSafe<{ code?: string }>(response))?.code).toBe('not_found')
      }

      const trendRes = await apiRequest(request, 'GET', trendUrl(agentId, evalSetVersion), { token: adminToken })
      expect(trendRes.status(), await trendRes.text()).toBe(200)
      const trend = await readJsonSafe<TrendResponse>(trendRes)
      expect(trend?.points.map((point) => point.suiteRunId)).toEqual([localBaseId, localHeadId])
      expect(trend?.points.flatMap((point) => point.agentVersions)).not.toContain(FOREIGN_VERSION)
      expect(trend?.versions).toEqual([expect.objectContaining({ agentVersion: LOCAL_VERSION, runCount: 2 })])

      restrictedRoleId = await createRoleFixture(request, superadminToken, {
        name: `qa-eval-regression-002-role-${stamp}`,
        tenantId: localScope.tenantId,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId,
        features: NON_MANAGE_FEATURES,
        organizations: null,
      })
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: restrictedEmail,
        password: RESTRICTED_PASSWORD,
        organizationId: localScope.organizationId,
        roles: [restrictedRoleId],
        name: 'QA TC-AGENT-EVAL-REGRESSION-002 non-manager',
      })
      const restrictedToken = await getAuthToken(request, restrictedEmail, RESTRICTED_PASSWORD)
      const forbiddenCompare = await apiRequest(request, 'GET', compareUrl(localBaseId, localHeadId), { token: restrictedToken })
      expect(forbiddenCompare.status(), 'compare must 403 without eval.manage').toBe(403)
      const forbiddenTrend = await apiRequest(request, 'GET', trendUrl(agentId, evalSetVersion), { token: restrictedToken })
      expect(forbiddenTrend.status(), 'trend must 403 without eval.manage').toBe(403)
    } finally {
      await deleteRegressionFixtures(ids).catch(() => undefined)
      const cleanupToken = superadminToken ?? (await getAuthToken(request, 'superadmin').catch(() => null))
      if (cleanupToken) {
        await deleteUserIfExists(request, cleanupToken, restrictedUserId).catch(() => undefined)
        await deleteRoleIfExists(request, cleanupToken, restrictedRoleId).catch(() => undefined)
        await deleteOrganizationIfExists(request, cleanupToken, otherOrganizationId).catch(() => undefined)
      }
    }
  })
})
