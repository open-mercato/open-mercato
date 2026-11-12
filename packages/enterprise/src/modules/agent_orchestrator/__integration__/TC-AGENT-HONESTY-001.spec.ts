import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsByIds, insertAgentRunFixtures } from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-HONESTY-001: flagging a run never mutates its forensic completed_at.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-data-honesty-pass.md
 * (§3.1, Phase 1). The audit live-confirmed the pre-fix defect: Flag moved the
 * displayed "Finished" time from 03:47 to 06:48 because the inspector rendered
 * `updated_at`, which `runs.toggleFlag` bumps by design.
 *
 * Seeds one terminal run with an explicit completed_at, then flags and unflags
 * it through the real API: `GET /runs/:id` must report the identical
 * completedAt after both mutations (while updatedAt legitimately moves).
 */

const AGENT_ID = 'deals.health_check'
const COMPLETED_AT = new Date('2026-07-10T03:47:00.000Z')

test.describe('TC-AGENT-HONESTY-001: completed_at is flag-proof', () => {
  test('flag then unflag leaves completedAt byte-identical', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const context = getTokenContext(superadminToken)
    const tenantId = context.tenantId
    const organizationId = context.organizationId
    expect(tenantId, 'superadmin token must carry a tenant id').toBeTruthy()
    expect(organizationId, 'superadmin token must carry an organization id').toBeTruthy()

    let runId: string | null = null
    try {
      ;[runId] = await insertAgentRunFixtures([
        {
          tenantId: tenantId!,
          organizationId: organizationId!,
          agentId: AGENT_ID,
          status: 'ok',
          createdAt: new Date('2026-07-10T03:46:55.000Z'),
          completedAt: COMPLETED_AT,
        },
      ])

      const before = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, {
        token: superadminToken,
      })
      expect(before.status()).toBe(200)
      const beforeBody = await readJsonSafe<{ run?: { completed_at?: string; completedAt?: string } }>(before)
      const beforeCompleted = beforeBody?.run?.completed_at ?? beforeBody?.run?.completedAt
      expect(beforeCompleted).toBeTruthy()
      expect(new Date(beforeCompleted!).toISOString()).toBe(COMPLETED_AT.toISOString())

      const flag = await apiRequest(request, 'POST', `/api/agent_orchestrator/runs/${runId}/flag`, {
        token: superadminToken,
      })
      expect(flag.status()).toBe(200)
      const flagBody = await readJsonSafe<{ flagged?: boolean }>(flag)
      expect(flagBody?.flagged).toBe(true)

      const afterFlag = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, {
        token: superadminToken,
      })
      const afterFlagBody = await readJsonSafe<{ run?: { completed_at?: string; completedAt?: string } }>(afterFlag)
      const afterFlagCompleted = afterFlagBody?.run?.completed_at ?? afterFlagBody?.run?.completedAt
      expect(new Date(afterFlagCompleted!).toISOString()).toBe(COMPLETED_AT.toISOString())

      const unflag = await apiRequest(request, 'POST', `/api/agent_orchestrator/runs/${runId}/flag`, {
        token: superadminToken,
      })
      expect(unflag.status()).toBe(200)
      const unflagBody = await readJsonSafe<{ flagged?: boolean }>(unflag)
      expect(unflagBody?.flagged).toBe(false)

      const afterUnflag = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, {
        token: superadminToken,
      })
      const afterUnflagBody = await readJsonSafe<{ run?: { completed_at?: string; completedAt?: string } }>(afterUnflag)
      const afterUnflagCompleted = afterUnflagBody?.run?.completed_at ?? afterUnflagBody?.run?.completedAt
      expect(new Date(afterUnflagCompleted!).toISOString()).toBe(COMPLETED_AT.toISOString())
    } finally {
      if (runId) await deleteAgentRunsByIds([runId])
    }
  })
})
