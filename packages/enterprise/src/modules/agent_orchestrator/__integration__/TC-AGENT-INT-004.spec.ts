import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import { agentRunPath } from './helpers/agentAccessFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'
import { GUARDRAIL_CHECKS_PATH, POLICY_CHECK_AGENT_ID, POLICY_CHECK_INPUT } from './helpers/integrityFixtures'

/**
 * TC-AGENT-INT-004: a real `support.policy_check` run records one integrity check per rule.
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md
 * (Testing Strategy → Integration → `POST /agents/:id/run`).
 *
 * Model-dependent: skipped without a provider (pre-filter) or when the run route
 * answers 503 (authoritative witness), like TC-AO-MCP-DISPATCH-001.
 *
 * The reply breaks known policies (asks for a password, promises a delivery
 * date), so the run returns 200 and:
 *   - `GET /runs/:id` lists output-phase guardrail checks of kinds
 *     `evidence_quote`, `reference_exists` and `tool_consulted` (one per rule);
 *   - the guardrail-checks list filtered by the run and each kind finds them;
 *   - every returned evidence quote is the exact `reply.slice(start, end)` and
 *     every returned policy id is one the resolver knows — whatever the model
 *     wrote, the integrity rules repaired or dropped the rest.
 *
 * Documented gaps (need a scripted model, absent here): forcing an invented
 * quote, wrong offsets, an unknown policy id or an uncited tool to assert the
 * `warn` verdicts, `dropped`/`repaired` counts and the raw-output artifact 200.
 * Those verdicts are covered by the pipeline and rule unit tests.
 *
 * Cleanup: the created AgentRun and its trace rows are deleted in `finally`.
 */

const INTEGRITY_RULE_KINDS = ['evidence_quote', 'reference_exists', 'tool_consulted'] as const
const KNOWN_POLICY_IDS = ['no-credentials', 'refund-window', 'no-delivery-dates', 'escalate-outages']

type PolicyFinding = {
  policyId?: string
  evidence?: Array<{ quote?: string; start?: number; end?: number }>
}
type PolicyRunBody = { runId?: unknown; kind?: string; data?: { findings?: PolicyFinding[] } }
type RunDetail = { guardrailChecks?: Array<{ kind?: string; phase?: string; result?: string }> }
type GuardrailCheckListBody = { items?: Array<{ kind?: string; agent_run_id?: string }> }

test.describe('TC-AGENT-INT-004: integrity checks on a real policy-check run', () => {
  test('records evidence_quote, reference_exists and tool_consulted checks and returns repaired output', async ({
    request,
  }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, token)), NO_LLM_PROVIDER_SKIP_REASON)

    const runIds: string[] = []
    try {
      const response = await apiRequest(request, 'POST', agentRunPath(POLICY_CHECK_AGENT_ID), {
        token,
        data: { input: POLICY_CHECK_INPUT },
      })
      test.skip(isModelUnavailableResponse(response.status()), NO_LLM_PROVIDER_SKIP_REASON)
      const raw = await response.text()
      expect(response.status(), raw).toBe(200)
      const body = JSON.parse(raw) as PolicyRunBody
      expect(typeof body.runId).toBe('string')
      const runId = String(body.runId)
      runIds.push(runId)

      expect(body.kind).toBe('research')
      for (const finding of body.data?.findings ?? []) {
        expect(KNOWN_POLICY_IDS).toContain(finding.policyId)
        for (const item of finding.evidence ?? []) {
          expect(typeof item.start).toBe('number')
          expect(typeof item.end).toBe('number')
          expect(item.quote).toBe(POLICY_CHECK_INPUT.reply.slice(item.start, item.end))
        }
      }

      const detail = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token })
      expect(detail.status(), await detail.text()).toBe(200)
      const detailBody = await readJsonSafe<RunDetail>(detail)
      const outputChecks = (detailBody?.guardrailChecks ?? []).filter((check) => check.phase === 'output')
      for (const kind of INTEGRITY_RULE_KINDS) {
        const matching = outputChecks.filter((check) => check.kind === kind)
        expect(matching, `one ${kind} check per rule`).toHaveLength(1)
        expect(['pass', 'warn', 'block']).toContain(matching[0].result)
      }

      for (const kind of INTEGRITY_RULE_KINDS) {
        const listed = await apiRequest(
          request,
          'GET',
          `${GUARDRAIL_CHECKS_PATH}?kind=${kind}&agentRunId=${runId}`,
          { token },
        )
        expect(listed.status(), await listed.text()).toBe(200)
        const listBody = await readJsonSafe<GuardrailCheckListBody>(listed)
        expect(listBody?.items ?? [], `guardrail-checks lists the ${kind} check`).toHaveLength(1)
        expect(listBody?.items?.[0]?.agent_run_id).toBe(runId)
      }
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
