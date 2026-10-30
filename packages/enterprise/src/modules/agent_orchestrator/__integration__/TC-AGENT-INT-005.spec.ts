import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentRunsWithTraceByIds } from './helpers/agentPerfFixtures'
import { agentRunPath } from './helpers/agentAccessFixtures'
import {
  hasConfiguredLlmProvider,
  isModelUnavailableResponse,
  NO_LLM_PROVIDER_SKIP_REASON,
} from './helpers/llmProvider'
import {
  GUARDRAIL_CHECKS_PATH,
  POLICY_CHECK_AGENT_ID,
  POLICY_CHECK_INPUT,
  REVIEW_RULE_ID,
  RULE_LESS_AGENT_ID,
  deleteSeededIntegrityRuns,
  seedReviewHoldRun,
  seedRuleLessRun,
  type SeededRun,
} from './helpers/integrityFixtures'

/**
 * TC-AGENT-INT-005: integrity review routing and untrusted inputs on the run, check, agent and scorer surfaces.
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md
 * (Phases 3–5; Testing Strategy → Integration).
 *
 * No model needed:
 *   - a run of an agent without integrity rules returns `integrity: null` and
 *     `rawOutputKey: null` from `GET /runs/:id`;
 *   - a seeded run carrying an `abstain_or_review` needs-review check and an
 *     input `prompt_injection` check returns `integrity.outcome = needs_review`;
 *   - `GET /guardrail-checks?kind=abstain_or_review` returns the seeded row with
 *     its `ruleId` and stays organization-scoped (a row seeded under another
 *     organization id is not returned);
 *   - `GET /agents/:id` lists `integrityRules` for `support.policy_check` and
 *     none for a rule-less agent;
 *   - `GET /eval-scorers` lists the `guardrail_check` scorer;
 *   - the trace page renders the new guardrail kind labels, the rule id, the
 *     "Holds approval" marker and the integrity outcome (screenshot attached).
 *
 * Model-dependent (skipped without a provider): a real `support.policy_check`
 * run returns an integrity summary whose rule ids match its declared rules.
 *
 * Documented gaps: no registered example agent declares an `abstain_or_review`
 * rule or `untrustedInputs`, so the not-applicable abstention, the review hold on
 * a real proposal, `run.review_requested` and an injection warn on a declared
 * input field cannot be driven end-to-end here; the rule, disposition, event and
 * screening unit tests cover them.
 *
 * Fixtures: runs and check rows are seeded through dbFixtures (precedent:
 * TC-AGENT-INT-001) and removed in `finally`.
 */

const integrationDirectory = path.dirname(fileURLToPath(import.meta.url))
const englishMessages = JSON.parse(
  readFileSync(path.join(integrationDirectory, '../i18n/en.json'), 'utf8'),
) as Record<string, string>

const POLICY_CHECK_RULE_IDS = ['quotes', 'policy-ids', 'policies-read']
const INTEGRITY_OUTCOMES = ['clean', 'repaired', 'flagged', 'not_applicable', 'needs_review']

type IntegritySummaryBody = {
  outcome?: string
  checks?: Array<{ ruleId?: string; kind?: string; result?: string; dropped?: number; repaired?: number }>
}
type RunDetailBody = { integrity?: IntegritySummaryBody | null; rawOutputKey?: string | null }
type GuardrailCheckListBody = {
  items?: Array<{ id?: string; kind?: string; result?: string; ruleId?: string | null }>
}
type AgentDetailBody = {
  integrityRules?: Array<{ id?: string; kind?: string; onViolation?: string | null; reviewRoute?: string | null }>
  integritySetVersion?: string | null
}
type ScorersBody = { scorers?: Array<{ scorerKey?: string; kind?: string }> }

function englishMessage(key: string): string {
  const message = englishMessages[key]
  if (!message) throw new Error(`[internal] en.json is missing "${key}"`)
  return message
}

function runDetailPath(runId: string): string {
  return `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}`
}

function kindFilterPath(kind: string, agentRunId: string): string {
  const params = new URLSearchParams({ kind, agentRunId, pageSize: '100' })
  return `${GUARDRAIL_CHECKS_PATH}?${params.toString()}`
}

test.describe('TC-AGENT-INT-005: integrity review and untrusted inputs', () => {
  test('run detail returns integrity null for a rule-less agent and the summary for a review hold', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    expect(tenantId, 'the admin token carries a tenant').toBeTruthy()
    expect(organizationId, 'the admin token carries an organization').toBeTruthy()

    const seeds: SeededRun[] = []
    try {
      const ruleLess = await seedRuleLessRun({ tenantId, organizationId })
      seeds.push(ruleLess)
      const ruleLessDetail = await apiRequest(request, 'GET', runDetailPath(ruleLess.runId), { token })
      expect(ruleLessDetail.status(), await ruleLessDetail.text()).toBe(200)
      const ruleLessBody = await readJsonSafe<RunDetailBody>(ruleLessDetail)
      expect(ruleLessBody).toHaveProperty('integrity', null)
      expect(ruleLessBody).toHaveProperty('rawOutputKey', null)

      const held = await seedReviewHoldRun({ tenantId, organizationId })
      seeds.push(held)
      const heldDetail = await apiRequest(request, 'GET', runDetailPath(held.runId), { token })
      expect(heldDetail.status(), await heldDetail.text()).toBe(200)
      const heldBody = await readJsonSafe<RunDetailBody>(heldDetail)
      expect(heldBody?.integrity?.outcome).toBe('needs_review')
      expect(heldBody?.integrity?.checks).toEqual([
        { ruleId: REVIEW_RULE_ID, kind: 'abstain_or_review', result: 'warn', dropped: 0, repaired: 0 },
      ])
      expect(heldBody?.rawOutputKey ?? null).toBeNull()
    } finally {
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })

  test('guardrail-checks kind=abstain_or_review returns the rule id and stays organization-scoped', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)

    const seeds: SeededRun[] = []
    try {
      const own = await seedReviewHoldRun({ tenantId, organizationId })
      seeds.push(own)
      const foreign = await seedReviewHoldRun({ tenantId, organizationId: randomUUID() })
      seeds.push(foreign)

      const ownResponse = await apiRequest(request, 'GET', kindFilterPath('abstain_or_review', own.runId), { token })
      expect(ownResponse.status(), await ownResponse.text()).toBe(200)
      const ownItems = (await readJsonSafe<GuardrailCheckListBody>(ownResponse))?.items ?? []
      expect(ownItems).toHaveLength(1)
      expect(ownItems[0]?.kind).toBe('abstain_or_review')
      expect(ownItems[0]?.result).toBe('warn')
      expect(ownItems[0]?.ruleId).toBe(REVIEW_RULE_ID)

      const injection = await apiRequest(request, 'GET', kindFilterPath('prompt_injection', own.runId), { token })
      expect(injection.status(), await injection.text()).toBe(200)
      const injectionItems = (await readJsonSafe<GuardrailCheckListBody>(injection))?.items ?? []
      expect(injectionItems).toHaveLength(1)
      expect(injectionItems[0]?.ruleId ?? null).toBeNull()

      const foreignResponse = await apiRequest(request, 'GET', kindFilterPath('abstain_or_review', foreign.runId), {
        token,
      })
      expect(foreignResponse.status(), await foreignResponse.text()).toBe(200)
      expect((await readJsonSafe<GuardrailCheckListBody>(foreignResponse))?.items ?? []).toHaveLength(0)

      const foreignDetail = await apiRequest(request, 'GET', runDetailPath(foreign.runId), { token })
      expect(foreignDetail.status(), 'another organization run is not readable').toBe(404)
    } finally {
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })

  test('agent detail lists integrity rules and eval-scorers lists guardrail_check', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const policyAgent = await apiRequest(request, 'GET', `/api/agent_orchestrator/agents/${POLICY_CHECK_AGENT_ID}`, {
      token,
    })
    expect(policyAgent.status(), await policyAgent.text()).toBe(200)
    const policyBody = await readJsonSafe<AgentDetailBody>(policyAgent)
    expect((policyBody?.integrityRules ?? []).map((rule) => rule.id)).toEqual(POLICY_CHECK_RULE_IDS)
    expect((policyBody?.integrityRules ?? []).map((rule) => rule.onViolation)).toEqual(['drop', 'drop', 'flag'])
    for (const rule of policyBody?.integrityRules ?? []) expect(rule.reviewRoute).toBeNull()
    expect(typeof policyBody?.integritySetVersion).toBe('string')

    const ruleLessAgent = await apiRequest(request, 'GET', `/api/agent_orchestrator/agents/${RULE_LESS_AGENT_ID}`, {
      token,
    })
    expect(ruleLessAgent.status(), await ruleLessAgent.text()).toBe(200)
    const ruleLessBody = await readJsonSafe<AgentDetailBody>(ruleLessAgent)
    expect(ruleLessBody?.integrityRules).toEqual([])
    expect(ruleLessBody?.integritySetVersion ?? null).toBeNull()

    const scorers = await apiRequest(request, 'GET', '/api/agent_orchestrator/eval-scorers', { token })
    expect(scorers.status(), await scorers.text()).toBe(200)
    const scorerBody = await readJsonSafe<ScorersBody>(scorers)
    const guardrailCheck = (scorerBody?.scorers ?? []).find((scorer) => scorer.scorerKey === 'guardrail_check')
    expect(guardrailCheck, 'the guardrail_check scorer is registered').toBeTruthy()
    expect(guardrailCheck?.kind).toBe('deterministic')
  })

  test('the trace page renders the review hold and untrusted-input check labels', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)

    const seeds: SeededRun[] = []
    try {
      const held = await seedReviewHoldRun({ tenantId, organizationId })
      seeds.push(held)

      await login(page, 'admin')
      await page.goto(`/backend/traces/${held.runId}`, { waitUntil: 'domcontentloaded' })

      const reviewRow = page
        .locator('li', { hasText: englishMessage('agent_orchestrator.traces.detail.guardrailKind.abstain_or_review') })
        .first()
      await expect(reviewRow).toBeVisible({ timeout: 15_000 })
      await expect(reviewRow).toContainText(REVIEW_RULE_ID)
      await expect(reviewRow).toContainText(englishMessage('agent_orchestrator.traces.detail.integrity.holdsApproval'))
      await expect(reviewRow).toContainText(englishMessage('agent_orchestrator.traces.detail.guardrailResult.warn'))

      const injectionRow = page
        .locator('li', { hasText: englishMessage('agent_orchestrator.traces.detail.guardrailKind.prompt_injection') })
        .first()
      await expect(injectionRow).toBeVisible()
      await expect(injectionRow).toContainText(englishMessage('agent_orchestrator.traces.detail.guardrailPhase.input'))

      await expect(
        page.getByText(englishMessage('agent_orchestrator.traces.detail.integrity.outcomeLabel'), { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText(englishMessage('agent_orchestrator.traces.detail.integrity.outcome.needs_review'), {
          exact: true,
        }),
      ).toBeVisible()

      await reviewRow.scrollIntoViewIfNeeded()
      await test.info().attach('trace-integrity-review-hold', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    } finally {
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })

  test('a real policy-check run returns an integrity summary for its declared rules', async ({ request }) => {
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
      const runBody = JSON.parse(raw) as { runId?: unknown; integrity?: IntegritySummaryBody | null }
      const runId = String(runBody.runId)
      runIds.push(runId)

      const detail = await apiRequest(request, 'GET', runDetailPath(runId), { token })
      expect(detail.status(), await detail.text()).toBe(200)
      const body = await readJsonSafe<RunDetailBody>(detail)
      expect(body?.integrity, 'an agent with integrity rules returns a summary').toBeTruthy()
      expect(INTEGRITY_OUTCOMES).toContain(body?.integrity?.outcome)
      expect((body?.integrity?.checks ?? []).map((check) => check.ruleId).sort()).toEqual(
        [...POLICY_CHECK_RULE_IDS].sort(),
      )
      expect(runBody.integrity, 'the run response carries the same summary').toEqual(body?.integrity)
      const rawOutputKey = body?.rawOutputKey ?? null
      if (rawOutputKey !== null) expect(rawOutputKey).toContain(`agent-runs/${runId}/`)
    } finally {
      await deleteAgentRunsWithTraceByIds(runIds).catch(() => undefined)
    }
  })
})
