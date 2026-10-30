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
 * TC-AGENT-PERF-002: GET /metrics/overview contract + RBAC.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-06-agent-orchestrator-performance-hardening.md
 * ("Integration Coverage": dispositionCounts matches seeded proposals; source rollup|live;
 * RBAC agent_orchestrator.proposals.view).
 *
 * dispositionCounts / pendingCount are CURRENT-STATE counts over the whole
 * organization, so exact assertions need an isolated org: a throwaway org +
 * a user homed there (TC-WF-028 fixture pattern) makes every count attributable
 * to this test's seeds. A fresh org has no metric-rollup rows, so `source` is
 * expected to be 'live' (the endpoint's documented fallback); runsTotal must
 * equal the seeded run count either way.
 */

type OverviewResponse = {
  window: string
  autoApproveRate: number | null
  pendingCount: number
  oldestPendingAt: string | null
  runsTotal: number
  dispositionCounts: Record<string, number>
  source: 'rollup' | 'live'
}

const VIEWER_FEATURES = ['agent_orchestrator.proposals.view', 'agent_orchestrator.trace.view']

test.describe('TC-AGENT-PERF-002: metrics/overview rollup-or-live figures + RBAC', () => {
  test('returns disposition counts, pending backlog and run totals for the seeded org; denies without proposals.view', async ({ request }) => {
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
    expect(tenantId, 'a tenant id is required to place the throwaway org').toBeTruthy()
    const tenantOpt = { tenantId }

    let orgId: string | null = null
    let viewerRoleId: string | null = null
    let viewerUserId: string | null = null
    let restrictedRoleId: string | null = null
    let restrictedUserId: string | null = null

    const now = Date.now()
    const oldestPendingAt = new Date(now - 2 * 60 * 60_000)

    try {
      orgId = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-agent-perf-002-${stamp}`, ...tenantOpt })

      viewerRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-agent-perf-002-viewer-${stamp}`, ...tenantOpt })
      await setRoleAclFeatures(request, superadminToken, { roleId: viewerRoleId, features: VIEWER_FEATURES, organizations: null })
      viewerUserId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-agent-perf-002-viewer-${stamp}@example.com`,
        password,
        organizationId: orgId,
        roles: [viewerRoleId],
        name: 'QA TC-AGENT-PERF-002 viewer',
      })
      const viewerToken = await getAuthToken(request, `qa-tc-agent-perf-002-viewer-${stamp}@example.com`, password)

      const seedScope = { tenantId, organizationId: orgId, agentId: `it-perf-002-${stamp}` }
      const runIds = await insertAgentRunFixtures([
        { ...seedScope, createdAt: new Date(now - 60 * 60_000) },
        { ...seedScope, createdAt: new Date(now - 30 * 60_000) },
      ])
      await insertAgentProposalFixtures([
        { ...seedScope, runId: runIds[0], disposition: 'pending', createdAt: oldestPendingAt },
        { ...seedScope, runId: runIds[0], disposition: 'pending', createdAt: new Date(now - 60 * 60_000) },
        { ...seedScope, runId: runIds[1], disposition: 'auto_approved', createdAt: new Date(now - 30 * 60_000) },
        { ...seedScope, runId: runIds[1], disposition: 'approved', createdAt: new Date(now - 20 * 60_000) },
        { ...seedScope, runId: runIds[1], disposition: 'rejected', createdAt: new Date(now - 10 * 60_000) },
      ])

      const response = await apiRequest(request, 'GET', '/api/agent_orchestrator/metrics/overview?window=7d', { token: viewerToken })
      expect(response.status(), await response.text()).toBe(200)
      const overview = (await response.json()) as OverviewResponse

      expect(overview.window).toBe('7d')
      expect(overview.dispositionCounts, 'dispositionCounts must match the seeded proposals exactly').toEqual({
        pending: 2,
        auto_approved: 1,
        approved: 1,
        edited: 0,
        rejected: 1,
      })
      expect(overview.pendingCount).toBe(2)

      expect(overview.oldestPendingAt, 'oldestPendingAt should be reported for a non-empty backlog').toBeTruthy()
      const reportedOldest = new Date(overview.oldestPendingAt as string).getTime()
      expect(
        Math.abs(reportedOldest - oldestPendingAt.getTime()),
        `oldestPendingAt should be the oldest seeded pending proposal (expected ~${oldestPendingAt.toISOString()}, got ${overview.oldestPendingAt})`,
      ).toBeLessThanOrEqual(2_000)

      // 3 disposed proposals in the window, 1 auto-approved => rate 1/3.
      expect(overview.autoApproveRate, 'autoApproveRate should be auto_approved / disposed').not.toBeNull()
      expect(Math.abs((overview.autoApproveRate as number) - 1 / 3)).toBeLessThanOrEqual(0.0001)

      expect(['rollup', 'live']).toContain(overview.source)
      // A brand-new org has no per-agent rollup rows yet => documented live fallback.
      expect(overview.source, 'a fresh org without rollup rows must fall back to live aggregates').toBe('live')
      expect(overview.runsTotal, 'runsTotal should count the seeded runs in the window').toBe(2)

      // RBAC: a user WITHOUT agent_orchestrator.proposals.view is denied.
      restrictedRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-agent-perf-002-restricted-${stamp}`, ...tenantOpt })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: restrictedRoleId,
        features: ['agent_orchestrator.trace.view'],
        organizations: null,
      })
      restrictedUserId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-agent-perf-002-restricted-${stamp}@example.com`,
        password,
        organizationId: orgId,
        roles: [restrictedRoleId],
        name: 'QA TC-AGENT-PERF-002 restricted',
      })
      const restrictedToken = await getAuthToken(request, `qa-tc-agent-perf-002-restricted-${stamp}@example.com`, password)
      const denied = await apiRequest(request, 'GET', '/api/agent_orchestrator/metrics/overview', { token: restrictedToken })
      expect(denied.status(), 'metrics/overview without proposals.view must be 403').toBe(403)
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => undefined)
      await deleteUserIfExists(request, superadminToken, restrictedUserId)
      await deleteRoleIfExists(request, superadminToken, restrictedRoleId)
      await deleteUserIfExists(request, superadminToken, viewerUserId)
      await deleteRoleIfExists(request, superadminToken, viewerRoleId)
      await deleteOrganizationIfExists(request, superadminToken, orgId)
    }
  })
})
