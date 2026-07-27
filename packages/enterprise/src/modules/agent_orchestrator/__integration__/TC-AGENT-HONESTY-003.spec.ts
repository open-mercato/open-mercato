import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteAgentRunsByIds, insertAgentRunFixtures } from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-HONESTY-003: per-agent metrics come from real server aggregates,
 * not a 100-row client sample. Source: spec
 * .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-data-honesty-pass.md
 * (§3.3(b), Integration Test Coverage).
 *
 * Seeds 120 runs across two throwaway agent ids (more than the old
 * pageSize=100 sample could ever see) and asserts GET /metrics/agents reports
 * the exact per-agent totals and error rates; the overview `traces` block is
 * present; a role without `agents.view` gets 403; >50 ids gets 400.
 */

const STAMP = `${Date.now()}-${randomInt(1000, 9999)}`
const AGENT_A = `qa.tc-honesty-003-a-${STAMP}`
const AGENT_B = `qa.tc-honesty-003-b-${STAMP}`

test.describe('TC-AGENT-HONESTY-003: server-side per-agent aggregates', () => {
  test('metrics/agents reports exact totals for >100 seeded runs', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const context = getTokenContext(superadminToken)
    const tenantId = context.tenantId!
    const organizationId = context.organizationId!
    expect(tenantId).toBeTruthy()
    expect(organizationId).toBeTruthy()

    const now = Date.now()
    const seeds = [
      // Agent A: 80 runs, 20 errors.
      ...Array.from({ length: 80 }, (_, index) => ({
        tenantId,
        organizationId,
        agentId: AGENT_A,
        status: (index < 20 ? 'error' : 'ok') as 'error' | 'ok',
        createdAt: new Date(now - (index + 1) * 60_000),
      })),
      // Agent B: 40 runs, all ok.
      ...Array.from({ length: 40 }, (_, index) => ({
        tenantId,
        organizationId,
        agentId: AGENT_B,
        status: 'ok' as const,
        createdAt: new Date(now - (index + 1) * 60_000),
      })),
    ]

    let runIds: string[] = []
    try {
      runIds = await insertAgentRunFixtures(seeds)

      const batch = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/metrics/agents?window=7d&ids=${encodeURIComponent(AGENT_A)},${encodeURIComponent(AGENT_B)}`,
        { token: superadminToken },
      )
      expect(batch.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(batch)
      const items = body?.items ?? []
      expect(items).toHaveLength(2)

      const itemA = items.find((item) => item.agentId === AGENT_A)!
      const itemB = items.find((item) => item.agentId === AGENT_B)!
      // Exact totals prove the numbers are windowed server aggregates — the old
      // implementation sampled the newest 100 global rows and could not see 120.
      expect(itemA.runsTotal).toBe(80)
      expect(itemA.errorRate as number).toBeCloseTo(20 / 80, 5)
      expect(itemB.runsTotal).toBe(40)
      expect(itemB.errorRate as number).toBeCloseTo(0, 5)
      expect(['rollup', 'live']).toContain(itemA.source)

      // The overview response carries the additive traces block + corrections.
      const overview = await apiRequest(request, 'GET', '/api/agent_orchestrator/metrics/overview?window=7d', {
        token: superadminToken,
      })
      expect(overview.status()).toBe(200)
      const overviewBody = await readJsonSafe<{ traces?: Record<string, unknown>; correctionsCount?: number }>(overview)
      expect(overviewBody?.traces).toBeTruthy()
      expect(['rollup', 'live']).toContain(overviewBody?.traces?.source)
      expect(typeof overviewBody?.correctionsCount).toBe('number')

      // Contract: >50 ids is a 400, not a silent truncation.
      const tooMany = Array.from({ length: 51 }, (_, index) => `qa.overflow-${index}`).join(',')
      const overflow = await apiRequest(request, 'GET', `/api/agent_orchestrator/metrics/agents?ids=${tooMany}`, {
        token: superadminToken,
      })
      expect(overflow.status()).toBe(400)
    } finally {
      await deleteAgentRunsByIds(runIds)
    }
  })

  test('metrics/agents 403s for a role without agents.view', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const context = getTokenContext(superadminToken)
    expect(context.tenantId).toBeTruthy()

    const email = `qa-tc-honesty-003-${STAMP}@example.com`
    const password = 'Secret123!'
    let roleId: string | null = null
    let userId: string | null = null
    try {
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-honesty-003-${STAMP}`,
        tenantId: context.tenantId!,
      })
      // Deliberately no agent_orchestrator.agents.view.
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['agent_orchestrator.proposals.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: context.organizationId!,
        roles: [roleId],
        name: 'QA TC-AGENT-HONESTY-003 runner',
      })
      const restrictedToken = await getAuthToken(request, email, password)

      const res = await apiRequest(request, 'GET', '/api/agent_orchestrator/metrics/agents?ids=any-agent', {
        token: restrictedToken,
      })
      expect(res.status()).toBe(403)
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
    }
  })
})
