import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsByIds, insertAgentRunFixtures } from './helpers/agentPerfFixtures'

/**
 * TC-AGENT-HONESTY-002: native runs stamp confidence and an estimated cost.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-data-honesty-pass.md
 * (§3.2, Phase 2, gate decision Q8).
 *
 * Part A executes a REAL agent run (LLM provider key required — env-gated, same
 * expectation as TC-AGENT-NAV-001) and asserts the run row carries token usage,
 * an estimated cost for the priced model, and — for actionable results — the
 * proposal's confidence. Part B asserts a run without a priced model keeps
 * cost null (the UI renders `—`): estimates are never invented.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

type RunResponse = { kind?: string; runId?: string | null; proposalId?: string | null }
type RunDetail = {
  run?: {
    confidence?: number | null
    input_tokens?: number | null
    inputTokens?: number | null
    output_tokens?: number | null
    outputTokens?: number | null
    cost_minor?: number | null
    costMinor?: number | null
    currency?: string | null
  }
}

function field(run: NonNullable<RunDetail['run']>, snake: string, camel: string): unknown {
  const record = run as Record<string, unknown>
  return record[snake] !== undefined ? record[snake] : record[camel]
}

test.describe('TC-AGENT-HONESTY-002: confidence + estimated cost stamping', () => {
  test('a live run stamps tokens, estimated cost, and proposal confidence', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)

    const agentsRes = await apiRequest(request, 'GET', '/api/agent_orchestrator/agents', { token })
    expect(agentsRes.status(), await agentsRes.text()).toBe(200)
    const agentsBody = await readJsonSafe<{ items?: Array<{ id?: string; sampleInput?: unknown; resultKind?: string }> }>(
      agentsRes,
    )
    // Prefer an actionable agent so the confidence stamp is exercised too.
    const agents = agentsBody?.items ?? []
    const agent =
      agents.find((item) => typeof item.id === 'string' && item.sampleInput !== undefined && item.resultKind === 'actionable') ??
      agents.find((item) => typeof item.id === 'string' && item.sampleInput !== undefined)
    expect(agent, 'a registered agent with a declared sampleInput is required').toBeTruthy()

    const runRes = await apiRequest(
      request,
      'POST',
      `/api/agent_orchestrator/agents/${encodeURIComponent(agent!.id!)}/run`,
      { token, data: { input: agent!.sampleInput } },
    )
    expect(runRes.status(), await runRes.text()).toBe(200)
    const run = (await runRes.json()) as RunResponse
    expect(typeof run.runId).toBe('string')

    const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${run.runId}`, { token })
    expect(detailRes.status()).toBe(200)
    const detail = await readJsonSafe<RunDetail>(detailRes)
    expect(detail?.run, 'run detail must return the run').toBeTruthy()
    const row = detail!.run!

    const inputTokens = field(row, 'input_tokens', 'inputTokens')
    const outputTokens = field(row, 'output_tokens', 'outputTokens')
    expect(typeof inputTokens, 'a live native run must stamp input tokens').toBe('number')
    expect(typeof outputTokens, 'a live native run must stamp output tokens').toBe('number')

    // The example agents declare priced models (claude-sonnet-4-5 / gpt-5 family
    // provider defaults) — the estimate must be computed and stamped.
    const costMinor = field(row, 'cost_minor', 'costMinor')
    expect(typeof costMinor, 'the estimated cost must be stamped for a priced model').toBe('number')
    expect(Number(costMinor)).toBeGreaterThanOrEqual(0)
    expect(field(row, 'currency', 'currency'), 'the estimate carries its currency').toBeTruthy()

    if (run.kind === 'actionable') {
      const confidence = field(row, 'confidence', 'confidence')
      expect(typeof confidence, 'actionable runs surface the proposal confidence on the run row').toBe('number')
    }
  })

  test('a run without a priced model keeps cost null — never a guess', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const context = getTokenContext(superadminToken)
    expect(context.tenantId).toBeTruthy()
    expect(context.organizationId).toBeTruthy()

    let runId: string | null = null
    try {
      ;[runId] = await insertAgentRunFixtures([
        {
          tenantId: context.tenantId!,
          organizationId: context.organizationId!,
          agentId: 'deals.health_check',
          status: 'ok',
          createdAt: new Date('2026-07-11T10:00:00.000Z'),
          completedAt: new Date('2026-07-11T10:00:05.000Z'),
        },
      ])

      const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, {
        token: superadminToken,
      })
      expect(detailRes.status()).toBe(200)
      const detail = await readJsonSafe<RunDetail>(detailRes)
      const costMinor = field(detail!.run!, 'cost_minor', 'costMinor')
      expect(costMinor ?? null, 'no priced model → cost stays null (UI renders —)').toBeNull()
    } finally {
      if (runId) await deleteAgentRunsByIds([runId])
    }
  })
})
