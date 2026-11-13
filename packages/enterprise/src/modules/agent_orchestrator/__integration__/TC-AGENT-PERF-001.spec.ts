import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteAgentProposalsByIds,
  deleteAgentRunsByIds,
  insertAgentProposalFixtures,
  insertAgentRunFixtures,
} from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-PERF-001: Default list ordering of GET /runs and GET /proposals.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-06-agent-orchestrator-performance-hardening.md
 * ("Integration Coverage": no `sortField` => `created_at DESC`; explicit `sortField` unchanged).
 *
 * Seeds 3 runs + 3 proposals with distinct explicit `created_at` values under a
 * unique agentId (see helpers/agentPerfFixtures.ts for why direct DB seeding is
 * required), then asserts:
 *  - no `sortField` => the seeded rows come back newest-first (created_at DESC),
 *  - the whole unfiltered first page is non-increasing in created_at,
 *  - an explicit `sortField=confidence&sortDir=asc` still sorts by confidence.
 */

type ListItem = {
  id: string
  agent_id: string
  confidence?: number | null
  created_at?: string | null
}

type ListResponse = { items?: ListItem[]; total?: number }

function toEpochMs(value: string | null | undefined): number {
  expect(typeof value, 'list items should carry created_at').toBe('string')
  const parsed = new Date(value as string).getTime()
  expect(Number.isNaN(parsed), `created_at should parse as a date (got ${value})`).toBe(false)
  return parsed
}

function expectNonIncreasingCreatedAt(items: ListItem[], label: string): void {
  for (let index = 1; index < items.length; index += 1) {
    const previous = toEpochMs(items[index - 1].created_at)
    const current = toEpochMs(items[index].created_at)
    expect(
      previous >= current,
      `${label}: item ${index} (${items[index].id}) is newer than item ${index - 1} — default order is not created_at DESC`,
    ).toBe(true)
  }
}

test.describe('TC-AGENT-PERF-001: default created_at DESC list ordering', () => {
  test('runs and proposals default to created_at DESC; explicit sortField is unchanged', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    expect(scope.tenantId, 'admin token should carry a tenant id').toBeTruthy()
    expect(scope.organizationId, 'admin token should carry an organization id').toBeTruthy()

    const agentTag = `it-perf-001-${Date.now()}-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const oldestAt = new Date(now - 3 * 60_000)
    const middleAt = new Date(now - 2 * 60_000)
    const newestAt = new Date(now - 60_000)
    const seedScope = { tenantId: scope.tenantId, organizationId: scope.organizationId, agentId: agentTag }

    let runIds: string[] = []
    let proposalIds: string[] = []

    try {
      // Seeded oldest → newest so ids[2] is the newest row.
      runIds = await insertAgentRunFixtures([
        { ...seedScope, createdAt: oldestAt },
        { ...seedScope, createdAt: middleAt },
        { ...seedScope, createdAt: newestAt },
      ])
      proposalIds = await insertAgentProposalFixtures([
        { ...seedScope, runId: runIds[0], confidence: 0.9, createdAt: oldestAt },
        { ...seedScope, runId: runIds[1], confidence: 0.2, createdAt: middleAt },
        { ...seedScope, runId: runIds[2], confidence: 0.5, createdAt: newestAt },
      ])

      // 1. GET /runs with NO sortField: the seeded rows return newest-first.
      const runsDefault = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/runs?agentId=${encodeURIComponent(agentTag)}&pageSize=50`,
        { token },
      )
      expect(runsDefault.status(), await runsDefault.text()).toBe(200)
      const runsBody = (await runsDefault.json()) as ListResponse
      const seededRuns = (runsBody.items ?? []).filter((item) => item.agent_id === agentTag)
      expect(seededRuns.map((item) => item.id), 'runs without sortField should be created_at DESC').toEqual([
        runIds[2],
        runIds[1],
        runIds[0],
      ])

      // 2. The unfiltered first page also obeys the default order globally.
      const runsPage = await apiRequest(request, 'GET', '/api/agent_orchestrator/runs?pageSize=50', { token })
      expect(runsPage.status()).toBe(200)
      const runsPageBody = (await runsPage.json()) as ListResponse
      expect((runsPageBody.items ?? []).length, 'unfiltered runs page should include the seeded rows').toBeGreaterThanOrEqual(3)
      expectNonIncreasingCreatedAt(runsPageBody.items ?? [], 'GET /runs (no sortField)')

      // 3. GET /proposals with NO sortField: newest-first as well.
      const proposalsDefault = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/proposals?agentId=${encodeURIComponent(agentTag)}&pageSize=50`,
        { token },
      )
      expect(proposalsDefault.status(), await proposalsDefault.text()).toBe(200)
      const proposalsBody = (await proposalsDefault.json()) as ListResponse
      const seededProposals = (proposalsBody.items ?? []).filter((item) => item.agent_id === agentTag)
      expect(
        seededProposals.map((item) => item.id),
        'proposals without sortField should be created_at DESC',
      ).toEqual([proposalIds[2], proposalIds[1], proposalIds[0]])

      const proposalsPage = await apiRequest(request, 'GET', '/api/agent_orchestrator/proposals?pageSize=50', { token })
      expect(proposalsPage.status()).toBe(200)
      const proposalsPageBody = (await proposalsPage.json()) as ListResponse
      expectNonIncreasingCreatedAt(proposalsPageBody.items ?? [], 'GET /proposals (no sortField)')

      // 4. An explicit sortField overrides the default: confidence ASC.
      const explicitSort = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/proposals?agentId=${encodeURIComponent(agentTag)}&sortField=confidence&sortDir=asc&pageSize=50`,
        { token },
      )
      expect(explicitSort.status(), await explicitSort.text()).toBe(200)
      const explicitBody = (await explicitSort.json()) as ListResponse
      const explicitSeeded = (explicitBody.items ?? []).filter((item) => item.agent_id === agentTag)
      // Compare by id, not by float value — `confidence` is a float4 column and
      // exact float equality across the pg → engine → JSON pipeline is brittle.
      expect(
        explicitSeeded.map((item) => item.id),
        'explicit sortField=confidence&sortDir=asc should sort by confidence (0.2, 0.5, 0.9), not created_at',
      ).toEqual([proposalIds[1], proposalIds[2], proposalIds[0]])
    } finally {
      await deleteAgentProposalsByIds(proposalIds).catch(() => undefined)
      await deleteAgentRunsByIds(runIds).catch(() => undefined)
    }
  })
})
