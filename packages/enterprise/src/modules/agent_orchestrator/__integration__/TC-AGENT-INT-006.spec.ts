import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteAgentEvalCasesByIds, deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import { deleteEvalSuiteRunsByIds, startEvalRun } from './helpers/evalReportFixtures'
import { hasConfiguredLlmProvider, NO_LLM_PROVIDER_SKIP_REASON } from './helpers/llmProvider'
import {
  POLICY_CHECK_AGENT_ID,
  POLICY_CHECK_INPUT,
  REVIEW_RULE_ID,
  deleteSeededIntegrityRuns,
  seedReviewHoldRun,
  type SeededRun,
} from './helpers/integrityFixtures'

/**
 * TC-AGENT-INT-006: the `guardrail_check` eval assertion scores persisted integrity checks.
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md
 * (Testing Strategy → Integration → "Eval suite with `guardrail_check` assertion" and
 * "Encryption").
 *
 * No model needed:
 *   - `POST /eval-assertions` accepts a `guardrail_check` assertion with a kind or
 *     rule id and rejects one with neither;
 *   - `POST /eval-assertions/preview` scores the seeded review-hold run's persisted
 *     check rows through the same scorer the eval replay uses: the expected verdict
 *     passes, a wrong one fails, and an expectation about a rule that never ran
 *     fails rather than skips.
 *
 * Model-dependent (skipped without a provider): an eval suite replay of
 * `support.policy_check` with a `guardrail_check` assertion records a scored
 * verdict for it, and the run's guardrail check rows never store the input reply
 * in plaintext (evidence is pointer-only; the input lives only in the encrypted
 * `agent_runs.input` column).
 *
 * Not covered (needs a repaired real run plus a `storage-s3` profile): the
 * ciphertext-at-rest assertion on the raw-output artifact object.
 *
 * Fixtures: the run and its check rows are seeded through dbFixtures (precedent:
 * TC-AGENT-INT-001); assertions, eval cases, suite runs and agent runs created
 * here are removed in `finally`.
 */

const ASSERTIONS_PATH = '/api/agent_orchestrator/eval-assertions'
const PREVIEW_PATH = '/api/agent_orchestrator/eval-assertions/preview'
const EVAL_RUNS_PATH = '/api/agent_orchestrator/eval-runs'

type PreviewBody = { passed?: boolean | null; scorerKey?: string; runId?: string }
type EvalRunDetailBody = { caseRuns?: Array<{ agent_run_id?: string | null }> }
type EvalReportBody = {
  cases?: Array<{
    trials?: Array<{ agentRunId?: string | null; results?: Array<{ assertionKey?: string; scorerKey?: string; passed?: boolean | null }> }>
  }>
}

async function previewGuardrailCheck(
  request: APIRequestContext,
  token: string,
  runId: string,
  config: Record<string, unknown>,
): Promise<boolean | null | undefined> {
  const response = await apiRequest(request, 'POST', PREVIEW_PATH, {
    token,
    data: { scorerKey: 'guardrail_check', runId, config },
  })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<PreviewBody>(response)
  expect(body?.scorerKey).toBe('guardrail_check')
  expect(body?.runId).toBe(runId)
  return body?.passed
}

async function createGuardrailAssertion(
  request: APIRequestContext,
  token: string,
  key: string,
  config: Record<string, unknown>,
): Promise<{ status: number; id: string | null }> {
  const response = await apiRequest(request, 'POST', ASSERTIONS_PATH, {
    token,
    data: {
      key,
      title: key,
      type: 'deterministic',
      scorerKey: 'guardrail_check',
      config,
      severity: 'warn',
      appliesTo: POLICY_CHECK_AGENT_ID,
      enabled: true,
    },
  })
  const id = response.status() === 201 ? ((await readJsonSafe<{ id?: string }>(response))?.id ?? null) : null
  return { status: response.status(), id }
}

async function deleteAssertions(request: APIRequestContext, token: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    await apiRequest(request, 'DELETE', `${ASSERTIONS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(
      () => undefined,
    )
  }
}

test.describe('TC-AGENT-INT-006: guardrail_check eval assertion', () => {
  test('guardrail_check assertions are validated and score persisted check rows', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const seeds: SeededRun[] = []
    const assertionIds: string[] = []

    try {
      const valid = await createGuardrailAssertion(request, token, `qa-int-006-${stamp}`, {
        ruleId: REVIEW_RULE_ID,
        expect: 'outcome:needs_review',
      })
      expect(valid.status, 'a guardrail_check assertion with a rule id is accepted').toBe(201)
      if (valid.id) assertionIds.push(valid.id)

      const invalid = await createGuardrailAssertion(request, token, `qa-int-006-invalid-${stamp}`, {
        expect: 'pass',
      })
      if (invalid.id) assertionIds.push(invalid.id)
      expect(invalid.status, 'a guardrail_check assertion needs a kind or a rule id').toBeGreaterThanOrEqual(400)
      expect(invalid.status).toBeLessThan(500)

      const held = await seedReviewHoldRun({ tenantId, organizationId })
      seeds.push(held)

      expect(await previewGuardrailCheck(request, token, held.runId, { ruleId: REVIEW_RULE_ID, expect: 'outcome:needs_review' })).toBe(true)
      expect(await previewGuardrailCheck(request, token, held.runId, { kind: 'abstain_or_review', expect: 'warn' })).toBe(true)
      expect(await previewGuardrailCheck(request, token, held.runId, { kind: 'abstain_or_review', expect: 'pass' })).toBe(false)
      expect(await previewGuardrailCheck(request, token, held.runId, { kind: 'prompt_injection', expect: 'not_block' })).toBe(true)
      expect(
        await previewGuardrailCheck(request, token, held.runId, { ruleId: 'rule-that-never-ran', expect: 'pass' }),
        'an expectation about a rule that never ran fails instead of skipping',
      ).toBe(false)
    } finally {
      await deleteAssertions(request, token, assertionIds)
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })

  test('an eval replay scores guardrail_check and check rows never hold the input in plaintext', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await hasConfiguredLlmProvider(request, token)), NO_LLM_PROVIDER_SKIP_REASON)

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const assertionIds: string[] = []
    const evalCaseIds: string[] = []
    const suiteRunIds: string[] = []
    const agentRunIds: string[] = []
    const assertionKey = `qa-int-006-replay-${stamp}`

    try {
      const assertion = await createGuardrailAssertion(request, token, assertionKey, {
        kind: 'evidence_quote',
        expect: 'not_block',
      })
      expect(assertion.status).toBe(201)
      if (assertion.id) assertionIds.push(assertion.id)

      const caseRes = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-cases', {
        token,
        data: { agentDefinitionId: POLICY_CHECK_AGENT_ID, name: assertionKey, input: POLICY_CHECK_INPUT },
      })
      expect(caseRes.status(), await caseRes.text()).toBe(201)
      const evalCaseId = (await readJsonSafe<{ id?: string }>(caseRes))?.id ?? ''
      expect(evalCaseId).toBeTruthy()
      evalCaseIds.push(evalCaseId)
      const approveRes = await apiRequest(
        request,
        'POST',
        `/api/agent_orchestrator/eval-cases/${encodeURIComponent(evalCaseId)}/approve`,
        { token },
      )
      expect(approveRes.status(), await approveRes.text()).toBe(200)

      const suiteRunId = await startEvalRun(request, token, POLICY_CHECK_AGENT_ID, [evalCaseId])
      suiteRunIds.push(suiteRunId)
      const detailRes = await apiRequest(request, 'GET', `${EVAL_RUNS_PATH}/${encodeURIComponent(suiteRunId)}`, { token })
      expect(detailRes.status(), await detailRes.text()).toBe(200)
      const detail = (await readJsonSafe<EvalRunDetailBody>(detailRes)) ?? {}
      for (const caseRun of detail.caseRuns ?? []) {
        if (caseRun.agent_run_id) agentRunIds.push(caseRun.agent_run_id)
      }

      const reportRes = await apiRequest(
        request,
        'GET',
        `${EVAL_RUNS_PATH}/${encodeURIComponent(suiteRunId)}/report?format=json`,
        { token },
      )
      expect(reportRes.status(), await reportRes.text()).toBe(200)
      const report = (await readJsonSafe<EvalReportBody>(reportRes)) ?? {}
      const trials = (report.cases ?? []).flatMap((entry) => entry.trials ?? [])
      const scoredTrial = trials.find((trial) => trial.agentRunId)
      test.skip(!scoredTrial, 'the model did not complete the replayed run in this environment')
      const result = (scoredTrial?.results ?? []).find((entry) => entry.assertionKey === assertionKey)
      expect(result?.scorerKey).toBe('guardrail_check')
      expect(typeof result?.passed, 'the guardrail_check assertion records a verdict').toBe('boolean')

      const runId = scoredTrial?.agentRunId ?? ''
      const evidenceRows = await withClient(async (client) => {
        const rows = await client.query<{ evidence: unknown }>(
          'select evidence from agent_guardrail_checks where agent_run_id = $1',
          [runId],
        )
        return rows.rows
      })
      expect(evidenceRows.length, 'the replayed run persisted guardrail checks').toBeGreaterThan(0)
      for (const row of evidenceRows) {
        expect(JSON.stringify(row.evidence ?? null)).not.toContain(POLICY_CHECK_INPUT.reply)
      }
    } finally {
      await deleteAssertions(request, token, assertionIds)
      await deleteAgentRunsWithTraceByIds(agentRunIds).catch(() => undefined)
      await deleteEvalSuiteRunsByIds(suiteRunIds).catch(() => undefined)
      await deleteAgentEvalCasesByIds(evalCaseIds).catch(() => undefined)
    }
  })
})
