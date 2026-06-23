import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-AGENT-TRACE-003: Per-agent metrics endpoint contract.
 * Source: spec .ai/specs/agent-orchestrator/next/2026-06-19-agent-trace-eval-capture.md
 *
 * The metrics endpoint returns a window-scoped quality summary (override rate,
 * eval-pass rate, latency, cost) computed from this module's tables. With no runs
 * for an agent the rates are null and counts are zero — a stable, RBAC-gated shape.
 */
test.describe('TC-AGENT-TRACE-003: per-agent metrics', () => {
  test('returns a window-scoped metrics envelope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      '/api/agent_orchestrator/agents/it-no-such-agent/metrics?window=7d',
      { token },
    )
    expect(response.status()).toBe(200)
    const body = (await response.json()) as {
      agentId: string
      window: string
      totalRuns: number
      evalPassRate: number | null
      overrideRate: number | null
    }
    expect(body.agentId).toBe('it-no-such-agent')
    expect(body.window).toBe('7d')
    expect(body.totalRuns).toBe(0)
    expect(body.evalPassRate).toBeNull()
    expect(body.overrideRate).toBeNull()
  })

  test('defaults to a 30d window for an unknown window value', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      '/api/agent_orchestrator/agents/it-no-such-agent/metrics?window=bogus',
      { token },
    )
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { window: string }
    expect(body.window).toBe('30d')
  })
})
