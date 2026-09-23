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
  type AgentProposalSeed,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-PERF-003: Caseload server-side pagination over >100 pending proposals.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-06-agent-orchestrator-performance-hardening.md
 * ("Integration Coverage": >100 seeded pending proposals paginate across pages
 * oldest-first; disposition tab filter is server-applied).
 *
 * Seeds 110 pending + 5 approved proposals (bulk multi-row inserts — fast) into
 * a throwaway org with strictly increasing `created_at`, then pages through
 * `GET /proposals?disposition=pending&sortField=createdAt&sortDir=asc` — the
 * exact query shape the Caseload page sends (backend/caseload/page.tsx). The
 * pre-hardening client-side `slice()` capped visibility at 100 rows; server
 * pagination must expose all 110 across 3 pages of 50, oldest-first, with the
 * approved rows excluded server-side from `total`.
 */

type ProposalListItem = { id: string; disposition: string; created_at?: string | null }
type ProposalListResponse = { items?: ProposalListItem[]; total?: number; totalPages?: number }

const PENDING_COUNT = 110
const APPROVED_COUNT = 5
const PAGE_SIZE = 50

test.describe('TC-AGENT-PERF-003: caseload server pagination beyond 100 pending proposals', () => {
  test('pages 110 pending proposals oldest-first with a server-applied disposition filter', async ({ request }) => {
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
    let roleId: string | null = null
    let userId: string | null = null

    try {
      orgId = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-agent-perf-003-${stamp}`, ...tenantOpt })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-agent-perf-003-${stamp}`, ...tenantOpt })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['agent_orchestrator.proposals.view', 'agent_orchestrator.trace.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-agent-perf-003-${stamp}@example.com`,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-AGENT-PERF-003',
      })
      const userToken = await getAuthToken(request, `qa-tc-agent-perf-003-${stamp}@example.com`, password)

      const seedScope = { tenantId, organizationId: orgId, agentId: `it-perf-003-${stamp}` }
      const base = Date.now() - (PENDING_COUNT + APPROVED_COUNT + 10) * 60_000
      const [runId] = await insertAgentRunFixtures([{ ...seedScope, createdAt: new Date(base) }])

      // 110 pending rows, 1 minute apart, oldest first — index i is the i-th oldest.
      const pendingSeeds: AgentProposalSeed[] = Array.from({ length: PENDING_COUNT }, (_, index) => ({
        ...seedScope,
        runId,
        disposition: 'pending' as const,
        createdAt: new Date(base + index * 60_000),
      }))
      // 5 approved rows interleaved in the same time range — must be excluded server-side.
      const approvedSeeds: AgentProposalSeed[] = Array.from({ length: APPROVED_COUNT }, (_, index) => ({
        ...seedScope,
        runId,
        disposition: 'approved' as const,
        createdAt: new Date(base + index * 60_000 + 30_000),
      }))
      const pendingIds = await insertAgentProposalFixtures(pendingSeeds)
      await insertAgentProposalFixtures(approvedSeeds)

      const fetchPage = async (page: number): Promise<ProposalListResponse> => {
        const response = await apiRequest(
          request,
          'GET',
          `/api/agent_orchestrator/proposals?disposition=pending&sortField=createdAt&sortDir=asc&page=${page}&pageSize=${PAGE_SIZE}`,
          { token: userToken },
        )
        expect(response.status(), await response.text()).toBe(200)
        return (await response.json()) as ProposalListResponse
      }

      // Page 1: the 50 oldest pending rows; total counts ONLY pending (110, not 115).
      const page1 = await fetchPage(1)
      expect(page1.total, 'total must be the server-filtered pending count (approved rows excluded)').toBe(PENDING_COUNT)
      expect(page1.totalPages).toBe(Math.ceil(PENDING_COUNT / PAGE_SIZE))
      expect((page1.items ?? []).map((item) => item.id)).toEqual(pendingIds.slice(0, PAGE_SIZE))

      // Page 2: the next slice, still oldest-first — rows 51..100.
      const page2 = await fetchPage(2)
      expect(page2.total).toBe(PENDING_COUNT)
      expect((page2.items ?? []).map((item) => item.id)).toEqual(pendingIds.slice(PAGE_SIZE, 2 * PAGE_SIZE))
      for (const item of page2.items ?? []) {
        expect(item.disposition, 'disposition=pending must be applied server-side').toBe('pending')
      }

      // Page 3: the backlog BEYOND the old 100-row client cap — rows 101..110.
      const page3 = await fetchPage(3)
      expect((page3.items ?? []).map((item) => item.id)).toEqual(pendingIds.slice(2 * PAGE_SIZE))
      expect((page3.items ?? []).length).toBe(PENDING_COUNT - 2 * PAGE_SIZE)
    } finally {
      await deleteAgentOrchestratorRowsForOrganization(orgId).catch(() => undefined)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, orgId)
    }
  })
})
