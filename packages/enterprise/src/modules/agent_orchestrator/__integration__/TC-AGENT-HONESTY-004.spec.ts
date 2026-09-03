import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAgentProposalsByIds,
  deleteAgentRunsByIds,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-HONESTY-004: the audit log is a server-paginated proposals list —
 * rows past the old 100-row client sample stay reachable, and its KPI source
 * (/metrics/overview dispositionCounts) reflects the real totals. Source: spec
 * .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-data-honesty-pass.md
 * (§3.3(c), Integration Test Coverage).
 *
 * Seeds 110 disposed proposals under one throwaway agent id and pages the
 * proposals API the same way the audit page does (createdAt desc, disposition
 * filter) past row 100; dispositionCounts must include all 110.
 */

const STAMP = `${Date.now()}-${randomInt(1000, 9999)}`
const AGENT_ID = `qa.tc-honesty-004-${STAMP}`
const SEEDED = 110

test.describe('TC-AGENT-HONESTY-004: audit log paginates server-side past row 100', () => {
  test('seeded dispositions are fully reachable and counted', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const context = getTokenContext(superadminToken)
    const tenantId = context.tenantId!
    const organizationId = context.organizationId!
    expect(tenantId).toBeTruthy()
    expect(organizationId).toBeTruthy()

    const now = Date.now()
    let runIds: string[] = []
    let proposalIds: string[] = []
    try {
      ;[...runIds] = await insertAgentRunFixtures([
        { tenantId, organizationId, agentId: AGENT_ID, status: 'ok', createdAt: new Date(now - 3_600_000) },
      ])
      const runId = runIds[0]
      proposalIds = await insertAgentProposalFixtures(
        Array.from({ length: SEEDED }, (_, index) => ({
          tenantId,
          organizationId,
          agentId: AGENT_ID,
          runId,
          disposition: 'approved' as const,
          createdAt: new Date(now - (index + 1) * 60_000),
        })),
      )

      // Baseline-independent assertion: dispositionCounts.approved grew by the
      // seeded amount is unverifiable without a before-snapshot, so instead we
      // assert the audit page's own listing path sees every seeded row.
      const pageSize = 50
      const seen = new Set<string>()
      for (let page = 1; page <= 10 && seen.size < SEEDED; page += 1) {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          sortField: 'createdAt',
          sortDir: 'desc',
          agentId: AGENT_ID,
          disposition: 'approved',
        })
        const res = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?${params.toString()}`, {
          token: superadminToken,
        })
        expect(res.status()).toBe(200)
        const body = await readJsonSafe<{ items?: Array<{ id?: string }>; total?: number }>(res)
        expect(body?.total, 'server total must count ALL seeded rows, not a 100-row sample').toBeGreaterThanOrEqual(
          SEEDED,
        )
        for (const item of body?.items ?? []) if (item.id) seen.add(item.id)
        if ((body?.items ?? []).length === 0) break
      }
      for (const id of proposalIds) {
        expect(seen.has(id), `seeded proposal ${id} must be reachable via server pagination`).toBe(true)
      }

      // The audit KPIs' source: current-state dispositionCounts includes the
      // seeded approvals (>= because other suites may add their own).
      const overview = await apiRequest(request, 'GET', '/api/agent_orchestrator/metrics/overview?window=7d', {
        token: superadminToken,
      })
      expect(overview.status()).toBe(200)
      const overviewBody = await readJsonSafe<{ dispositionCounts?: Record<string, number> }>(overview)
      expect(overviewBody?.dispositionCounts?.approved ?? 0).toBeGreaterThanOrEqual(SEEDED)
    } finally {
      await deleteAgentProposalsByIds(proposalIds)
      await deleteAgentRunsByIds(runIds)
    }
  })
})
