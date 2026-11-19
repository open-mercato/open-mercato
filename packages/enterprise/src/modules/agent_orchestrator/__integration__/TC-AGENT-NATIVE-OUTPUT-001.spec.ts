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

/**
 * TC-AGENT-NATIVE-OUTPUT-001: a file-defined agent returns provider-native
 * structured output on the native runtime (#9648 A-2).
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-07-07-lightweight-agent-runtime.md
 * (Changelog → 2026-11-17 A-2).
 *
 * `support.resolution_advisor` is the shipped example whose OUTCOME.md has
 * optional `payload` properties — the shape OpenAI's strict mode rejects unless
 * the model is given the strict variant. A real run must:
 *   - answer 200 with a proposal (the strict schema was accepted by the provider);
 *   - carry no `null` for the optional payload fields the model was allowed to
 *     null out (they are mapped back onto the authored schema);
 *   - be recorded with `runtime: 'native'` and a passing output `schema` check.
 *
 * Model-dependent: skipped without a provider (pre-filter) or when the run route
 * answers 503, like TC-AGENT-INT-004. Cleanup deletes the run, its proposal and
 * its trace rows in `finally`.
 */

const AGENT_ID = 'support.resolution_advisor'
const INPUT = {
  subject: 'Still can’t process payouts',
  body: 'Third day our payouts are stuck and support has not replied. This is blocking our whole finance team.',
  customerEmail: 'vip@acme.test',
}
const OPTIONAL_PAYLOAD_KEYS = ['priority', 'team', 'macroId']

type RunBody = { runId?: unknown; kind?: string; proposal?: unknown }
type RunDetail = {
  run?: { runtime?: string; status?: string }
  guardrailChecks?: Array<{ kind?: string; phase?: string; result?: string }>
}

function collectNullKeys(value: unknown, keys: readonly string[], found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNullKeys(item, keys, found)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === null && keys.includes(key)) found.push(key)
      collectNullKeys(child, keys, found)
    }
  }
  return found
}

test.describe('TC-AGENT-NATIVE-OUTPUT-001: native structured output for a file-defined agent', () => {
  test('returns a schema-valid proposal from support.resolution_advisor on the native runtime', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, token)), NO_LLM_PROVIDER_SKIP_REASON)

    const runIds: string[] = []
    try {
      const response = await apiRequest(request, 'POST', agentRunPath(AGENT_ID), { token, data: { input: INPUT } })
      test.skip(isModelUnavailableResponse(response.status()), NO_LLM_PROVIDER_SKIP_REASON)
      const raw = await response.text()
      expect(response.status(), raw).toBe(200)
      const body = JSON.parse(raw) as RunBody
      expect(typeof body.runId).toBe('string')
      const runId = String(body.runId)
      runIds.push(runId)

      expect(body.kind).toBe('proposal')
      expect(collectNullKeys(body.proposal, OPTIONAL_PAYLOAD_KEYS), 'optional payload nulls are mapped back').toEqual([])

      const detail = await apiRequest(request, 'GET', `/api/agent_orchestrator/runs/${runId}`, { token })
      expect(detail.status(), await detail.text()).toBe(200)
      const detailBody = await readJsonSafe<RunDetail>(detail)
      expect(detailBody?.run?.runtime).toBe('native')
      const schemaChecks = (detailBody?.guardrailChecks ?? []).filter(
        (check) => check.phase === 'output' && check.kind === 'schema',
      )
      expect(schemaChecks.length).toBeGreaterThan(0)
      expect(schemaChecks.every((check) => check.result === 'pass')).toBe(true)
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
