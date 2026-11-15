import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
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
import {
  deleteAgentOrchestratorRowsForOrganization,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-PERF-004: Tenant/organization isolation of the hardened read paths (mandatory).
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-06-agent-orchestrator-performance-hardening.md
 * ("Integration Coverage": Org B gets never rows on metrics/overview and
 * paginated proposals for org A).
 *
 * Two sibling orgs in the same tenant, one user homed in each (TC-WF-028
 * fixture pattern). A proposal + run seeded in org A must be invisible to the
 * org-B user on every read surface this hardening touched: the paginated
 * `/proposals` list, the `/runs` list, and `/metrics/overview` counts. The
 * org-A user is the positive control proving the seeds ARE served — so the
 * org-B "zero rows" assertions cannot pass vacuously.
 *
 * The per-tenant admission semaphore half of this spec row is process-local
 * env-tuned behavior — covered by unit tests + the manual runbook in
 * TC-AGENT-PERF-ENV-README.md, not here.
 */

type ListItem = { id: string }
type ListResponse = { items?: ListItem[]; total?: number }
type OverviewResponse = {
  pendingCount: number
  oldestPendingAt: string | null
  runsTotal: number
  dispositionCounts: Record<string, number>
}

const VIEWER_FEATURES = ['agent_orchestrator.proposals.view', 'agent_orchestrator.trace.view']

test.describe('TC-AGENT-PERF-004: org isolation on proposals, runs and metrics/overview', () => {
  test('org B never sees org A rows on the paginated lists or the overview counts', async ({ request }) => {
    test.slow()

    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    let tenantId = getTokenContext(superadminToken).tenantId
    if (!tenantId) {
      const existing = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', { token: superadminToken })
      const body = await readJsonSafe<{ items?: Array<{ tenantId?: string | null }> }>(existing)
      tenantId = body?.items?.[0]?.tenantId ?? ''
    }
    expect(tenantId, 'a tenant id is required to place the throwaway orgs').toBeTruthy()
    const tenantOpt = { tenantId }

    let orgAId: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null

    let seededRunId: string | null = null
    let seededProposalId: string | null = null

    try {
      orgAId = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-agent-perf-004-a-${stamp}`, ...tenantOpt })
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-agent-perf-004-b-${stamp}`, ...tenantOpt })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-agent-perf-004-${stamp}`, ...tenantOpt })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: VIEWER_FEATURES, organizations: null })
      userAId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-agent-perf-004-a-${stamp}@example.com`,
        password,
        organizationId: orgAId,
        roles: [roleId],
        name: 'QA TC-AGENT-PERF-004 org A',
      })
      userBId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-agent-perf-004-b-${stamp}@example.com`,
        password,
        organizationId: orgBId,
        roles: [roleId],
        name: 'QA TC-AGENT-PERF-004 org B',
      })
      const tokenA = await getAuthToken(request, `qa-tc-agent-perf-004-a-${stamp}@example.com`, password)
      const tokenB = await getAuthToken(request, `qa-tc-agent-perf-004-b-${stamp}@example.com`, password)

      const seedScope = { tenantId, organizationId: orgAId, agentId: `it-perf-004-${stamp}` }
      const runIds = await insertAgentRunFixtures([{ ...seedScope, createdAt: new Date(Date.now() - 60_000) }])
      seededRunId = runIds[0]
      const proposalIds = await insertAgentProposalFixtures([
        { ...seedScope, runId: seededRunId, disposition: 'pending', createdAt: new Date(Date.now() - 60_000) },
      ])
      seededProposalId = proposalIds[0]

      // Positive control: the org-A user sees exactly the seeded rows.
      const proposalsA = await apiRequest(request, 'GET', '/api/agent_orchestrator/proposals?page=1&pageSize=50', { token: tokenA })
      expect(proposalsA.status(), await proposalsA.text()).toBe(200)
      const proposalsABody = (await proposalsA.json()) as ListResponse
      expect(proposalsABody.total, 'org A should serve the seeded proposal').toBe(1)
      expect((proposalsABody.items ?? []).map((item) => item.id)).toEqual([seededProposalId])

      const runsA = await apiRequest(request, 'GET', '/api/agent_orchestrator/runs?page=1&pageSize=50', { token: tokenA })
      expect(runsA.status()).toBe(200)
      const runsABody = (await runsA.json()) as ListResponse
      expect((runsABody.items ?? []).map((item) => item.id)).toEqual([seededRunId])

      // Org B: the paginated proposals list must return ZERO org-A rows.
      const proposalsB = await apiRequest(request, 'GET', '/api/agent_orchestrator/proposals?page=1&pageSize=50', { token: tokenB })
      expect(proposalsB.status(), await proposalsB.text()).toBe(200)
      const proposalsBBody = (await proposalsB.json()) as ListResponse
      expect(proposalsBBody.total, 'org B must not count org A proposals').toBe(0)
      expect(proposalsBBody.items ?? []).toEqual([])

      // Org B with the pending filter + pagination params the Caseload sends: still nothing.
      const caseloadB = await apiRequest(
        request,
        'GET',
        '/api/agent_orchestrator/proposals?disposition=pending&sortField=createdAt&sortDir=asc&page=1&pageSize=50',
        { token: tokenB },
      )
      expect(caseloadB.status()).toBe(200)
      const caseloadBBody = (await caseloadB.json()) as ListResponse
      expect(caseloadBBody.total).toBe(0)
      expect((caseloadBBody.items ?? []).some((item) => item.id === seededProposalId), 'org A proposal leaked into org B caseload').toBe(false)

      // Org B: the runs list must not include the org-A run.
      const runsB = await apiRequest(request, 'GET', '/api/agent_orchestrator/runs?page=1&pageSize=50', { token: tokenB })
      expect(runsB.status()).toBe(200)
      const runsBBody = (await runsB.json()) as ListResponse
      expect((runsBBody.items ?? []).some((item) => item.id === seededRunId), 'org A run leaked into org B runs list').toBe(false)
      expect(runsBBody.total).toBe(0)

      // Org B: overview counts exclude org A entirely — a fresh org reads all zeros.
      const overviewB = await apiRequest(request, 'GET', '/api/agent_orchestrator/metrics/overview', { token: tokenB })
      expect(overviewB.status(), await overviewB.text()).toBe(200)
      const overviewBBody = (await overviewB.json()) as OverviewResponse
      expect(overviewBBody.pendingCount, 'org B pendingCount must exclude org A backlog').toBe(0)
      expect(overviewBBody.oldestPendingAt).toBeNull()
      expect(overviewBBody.runsTotal, 'org B runsTotal must exclude org A runs').toBe(0)
      for (const [disposition, count] of Object.entries(overviewBBody.dispositionCounts)) {
        expect(count, `org B dispositionCounts.${disposition} must be 0`).toBe(0)
      }

      // Positive control on the overview too: org A reports its own backlog.
      const overviewA = await apiRequest(request, 'GET', '/api/agent_orchestrator/metrics/overview', { token: tokenA })
      expect(overviewA.status()).toBe(200)
      const overviewABody = (await overviewA.json()) as OverviewResponse
      expect(overviewABody.pendingCount).toBe(1)
      expect(overviewABody.runsTotal).toBe(1)
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgAId).catch(() => undefined)
      await deleteAgentOrchestratorRowsForOrganization(orgBId).catch(() => undefined)
      await deleteUserIfExists(request, superadminToken, userAId)
      await deleteUserIfExists(request, superadminToken, userBId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, orgAId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
