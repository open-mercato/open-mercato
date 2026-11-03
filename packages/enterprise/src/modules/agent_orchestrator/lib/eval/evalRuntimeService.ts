import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentEvalAssertion,
  AgentEvalCase,
  AgentEvalResult,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
} from '../../data/entities'
import { parseCaseAssertionRefs, resolveEffectiveAssertions } from './assertionResolution'
import { canonicalInputKey } from './canonicalInputKey'
import { projectRunView } from './projectRunView'
import { runScorer } from './registry'
import { SKIP_REASON, type Json } from './types'

export type EvaluateRunScope = { tenantId: string; organizationId: string }

export type EvaluateRunResult = {
  /**
   * Assertions PROCESSED, including skipped ones.
   *
   * NOTE: this is NOT the pre-registry meaning. Previously an unknown-scorer
   * assertion hit a `continue` and was never counted; now it is processed and
   * recorded as SKIPPED. Callers that want "something was actually measured" —
   * `commands/trace.ts` gating the `run.evaluated` event, for one — must use
   * `scored`, or they will announce an evaluation of a run where nothing was.
   */
  evaluated: number
  scored: number
  skipped: number
  evalPassed: boolean | null
  evalScore: number | null
  /** Id of the approved golden case this run's input matched, or null. */
  goldenCaseId: string | null
  /** AND of the matched golden case's gate verdicts; null when unmatched or no gate applied. */
  goldenPassed: boolean | null
}

/**
 * Run the enabled deterministic assertions for a run inline at ingest, write an
 * `AgentEvalResult` per assertion, and stamp the run's `evalScore`/`evalPassed`.
 *
 * `evalPassed` is the AND of all `gate` results (null when no gate assertion
 * applies — the lifecycle gate reads `false` as a hard fail). `warn` results are
 * recorded but never affect `evalPassed`.
 *
 * SKIPPED results (`passed: null`) are written for visibility but excluded from
 * BOTH aggregations: a config typo or a missing expected value must never move a
 * gate verdict. Shares its registry with the offline replay engine and CI gate.
 */
export async function evaluateRun(
  em: EntityManager,
  scope: EvaluateRunScope,
  runId: string,
): Promise<EvaluateRunResult> {
  const empty: EvaluateRunResult = { evaluated: 0, scored: 0, skipped: 0, evalPassed: null, evalScore: null, goldenCaseId: null, goldenPassed: null }

  const run = await findOneWithDecryption(
    em,
    AgentRun,
    { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!run) return empty

  const assertions = await em.find(AgentEvalAssertion, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    type: 'deterministic',
    enabled: true,
    deletedAt: null,
    appliesTo: { $in: [run.agentId, '*'] },
  })

  // Golden-match lookup up-front (one indexed query): a live/playground run whose
  // input reproduces an APPROVED eval case is scored against that case's `expected`.
  // Deliberately NOT gated behind the agent having online assertions — a golden
  // comparison (and its diff) is meaningful even for an agent with none.
  const matchedCase = await findOneWithDecryption(
    em,
    AgentEvalCase,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      agentDefinitionId: run.agentId,
      inputKey: canonicalInputKey(run.input),
      status: 'approved',
    },
    { orderBy: { createdAt: 'asc' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!assertions.length && !matchedCase) return empty

  // Tool calls and spans feed the trajectory scorers; the proposal supplies
  // `disposition`. Loaded once and projected, so the scorer path stays pure.
  const toolCalls = await findWithDecryption(
    em,
    AgentToolCall,
    { agentRunId: run.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const spans = await em.find(AgentSpan, {
    agentRunId: run.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const proposal = await em.findOne(AgentProposal, {
    runId: run.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  const runView = projectRunView({
    run,
    toolCalls,
    spans,
    disposition: proposal?.disposition ?? null,
  })

  // BOTH planes must resolve the assertion set the same way. Skipping this call
  // online (as an earlier version did) meant a wildcard assertion and an
  // agent-specific one sharing a slug BOTH ran online but only ONE ran offline —
  // so a seeded `'*'` gate could be shadowed away in the replay plane while still
  // gating production, and the two planes would silently disagree about what was
  // measured.
  const resolved = resolveEffectiveAssertions(assertions, [])

  const verdicts: Array<{ severity: 'gate' | 'warn'; passed: boolean | null; score: number | null }> = []

  for (const entry of resolved) {
    // The online plane evaluates an AgentRun, which has no eval case attached —
    // hence `expected: null`. Scorers that need it skip via `needsExpected`.
    const verdict = runScorer(entry.scorerKey, runView, null, entry.config)

    em.persist(
      em.create(AgentEvalResult, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentRunId: run.id,
        assertionId: entry.assertion.id,
        assertionKey: entry.assertion.key,
        passed: verdict.passed,
        score: verdict.score,
        severity: entry.assertion.severity,
        evidence: verdict.evidence ?? null,
      }),
    )
    verdicts.push({ severity: entry.assertion.severity, passed: verdict.passed, score: verdict.score })
  }
  await em.flush()

  // Golden-match plane: if this run's input reproduces an APPROVED eval case,
  // additionally score the run against that case's `expected` — the higher-signal
  // checks the online plane skips for lack of an expected value — and record a
  // self-contained golden verdict set tagged with `matchedEvalCaseId`. Reuses the
  // same registry + resolution as the offline replay engine (`scoreCaseRun`), so
  // the two planes can never disagree about what a golden means.
  let goldenCaseId: string | null = null
  let goldenPassed: boolean | null = null
  if (matchedCase) {
    goldenCaseId = matchedCase.id
    const goldenResolved = resolveEffectiveAssertions(assertions, parseCaseAssertionRefs(matchedCase.assertions))
    const goldenGate: boolean[] = []
    for (const entry of goldenResolved) {
      const verdict = entry.configError
        ? { passed: null as boolean | null, score: null as number | null, evidence: { reason: SKIP_REASON.invalidConfig, issues: entry.configError } as Json }
        : runScorer(entry.scorerKey, runView, (matchedCase.expected ?? null) as Json | null, entry.config)
      em.persist(
        em.create(AgentEvalResult, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          agentRunId: run.id,
          matchedEvalCaseId: matchedCase.id,
          assertionId: entry.assertion.id,
          assertionKey: entry.assertion.key,
          passed: verdict.passed,
          score: verdict.score,
          severity: entry.assertion.severity,
          evidence: verdict.evidence ?? null,
        }),
      )
      if (entry.assertion.severity === 'gate' && verdict.passed !== null) goldenGate.push(verdict.passed)
    }
    await em.flush()
    goldenPassed = goldenGate.length ? goldenGate.every((passed) => passed === true) : null
  }

  const scored = verdicts.filter((entry) => entry.passed !== null)
  const gate = scored.filter((entry) => entry.severity === 'gate')
  const evalPassed = gate.length ? gate.every((entry) => entry.passed === true) : null
  const withScore = scored.filter((entry) => typeof entry.score === 'number')
  const evalScore = withScore.length
    ? withScore.reduce((sum, entry) => sum + (entry.score as number), 0) / withScore.length
    : null

  run.evalScore = evalScore
  run.evalPassed = evalPassed
  run.goldenCaseId = goldenCaseId
  run.goldenPassed = goldenPassed
  await em.flush()

  return {
    evaluated: verdicts.length,
    scored: scored.length,
    skipped: verdicts.length - scored.length,
    evalPassed,
    evalScore,
    goldenCaseId,
    goldenPassed,
  }
}
