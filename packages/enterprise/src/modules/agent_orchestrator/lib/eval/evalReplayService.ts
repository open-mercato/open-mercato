import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  AgentEvalAssertion,
  AgentEvalCase,
  AgentEvalCaseRun,
  AgentEvalResult,
  AgentEvalSuiteRun,
  AgentPrincipal,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
} from '../../data/entities'
import { parseCaseAssertionRefs, resolveEffectiveAssertions } from './assertionResolution'
import { projectRunView } from './projectRunView'
import { runScorer } from './registry'
import { createModelJudge, runLlmJudgeForRun, type JudgeCaseLinkage } from './llmJudge'
import {
  EVAL_SET_CASE_MISSING,
  EVAL_SET_UNRESOLVED,
  readEvalSetPointer,
  resolveManifest,
  resolveManifestCaseAssertions,
  type EvalSetManifest,
  type EvalSetManifestCase,
} from './manifest'
import { createEvalSetManifestCache, evalSetManifestCacheKey } from './manifestCache'
import { SKIP_REASON, type Json } from './types'
import { emitAgentOrchestratorEvent } from '../../events'
import { withRuntimeAuditWrite } from '../identity/agentWriteScope'

const logger = createLogger('agent_orchestrator').child({ component: 'eval-replay' })

/**
 * Per-case progress. Deliberately TINY: the cross-process event bridge serializes
 * the envelope into `pg_notify` and DROPS it above MAX_MESSAGE_BYTES (7 000) with
 * only a `logger.warn` — a fat payload would make the UI look frozen with no error
 * anywhere. Ids, counters, status and a short label only; never an error body,
 * tool args or case input. `tenantId`/`organizationId` are required for the bridge
 * to publish at all (`isBroadcastEvent && hasTenantScope`).
 */
const PROGRESS_LABEL_MAX = 120

async function emitCaseProgress(
  phase: 'started' | 'completed',
  caseRun: AgentEvalCaseRun,
  agentDefinitionId: string,
  scope: EvalScope,
): Promise<void> {
  try {
    await emitAgentOrchestratorEvent(
      phase === 'started'
        ? 'agent_orchestrator.eval_case_run.started'
        : 'agent_orchestrator.eval_case_run.completed',
      {
        id: caseRun.id,
        suiteRunId: caseRun.suiteRunId,
        evalCaseId: caseRun.evalCaseId,
        agentDefinitionId: agentDefinitionId.slice(0, PROGRESS_LABEL_MAX),
        trialIndex: caseRun.trialIndex,
        status: caseRun.status,
        passed: caseRun.passed ?? null,
        score: caseRun.score ?? null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    )
  } catch {
    // Progress is best-effort: a broadcast failure must never fail a case run.
  }
}

export type EvalScope = { tenantId: string; organizationId: string }

export type ReplayCaseOutcome = {
  caseRunId: string
  status: AgentEvalCaseRun['status']
  passed: boolean | null
  score: number | null
}

type AgentRuntimeLike = {
  run: (
    agentId: string,
    input: unknown,
    ctx: {
      tenantId: string
      organizationId: string
      userId: string
      onRunPersisted?: (runId: string) => void
      source?: 'runtime' | 'eval'
      runAs?: { agentUserId: string; onBehalfOfUserId?: string | null }
    },
  ) => Promise<unknown>
}

const manifestCache = createEvalSetManifestCache()

export function resetEvalSetManifestCache(): void {
  manifestCache.clear()
}

type SuiteManifest = { pinned: false } | { pinned: true; manifest: EvalSetManifest | null }

/**
 * Resolves the frozen eval-set manifest a suite run was started with. Keyed by
 * tenant, organization and version: the version is a content hash, so every
 * suite run pinned to it shares one entry. Only successful resolutions are
 * cached process-wide: a miss may be a transient read a later suite run retries.
 * Within one suite run a miss is remembered in `unresolvedVersions`, so the
 * unbounded resolution scan runs at most once per suite run.
 */
async function loadSuiteManifest(
  em: EntityManager,
  suiteRun: AgentEvalSuiteRun | null,
  scope: EvalScope,
  unresolvedVersions?: Set<string>,
): Promise<SuiteManifest> {
  const pointer = suiteRun ? readEvalSetPointer(suiteRun.summary) : null
  if (!suiteRun || !pointer) return { pinned: false }
  const cacheKey = evalSetManifestCacheKey(scope, pointer.version)
  const cached = manifestCache.get(cacheKey)
  if (cached) return { pinned: true, manifest: cached }
  if (unresolvedVersions?.has(cacheKey)) return { pinned: true, manifest: null }
  const manifest = await resolveManifest(em, scope, suiteRun.agentDefinitionId, pointer.version)
  if (manifest) manifestCache.set(cacheKey, manifest)
  else unresolvedVersions?.add(cacheKey)
  return { pinned: true, manifest }
}

type ReplaySource =
  | { kind: 'live'; evalCase: AgentEvalCase }
  | { kind: 'manifest'; manifest: EvalSetManifest; manifestCase: EvalSetManifestCase }

type ReplayAssertion = {
  id: string
  key: string
  severity: 'gate' | 'warn'
  scorerKey: string
  config: unknown
  configError?: string[]
}

function sourceAgentId(source: ReplaySource): string {
  return source.kind === 'live' ? source.evalCase.agentDefinitionId : source.manifest.agentId
}

function sourceInput(source: ReplaySource): unknown {
  return source.kind === 'live' ? source.evalCase.input : source.manifestCase.input
}

function sourceExpected(source: ReplaySource): Json | null {
  return source.kind === 'live'
    ? ((source.evalCase.expected ?? null) as Json | null)
    : source.manifestCase.expected
}

function judgeLinkageFor(source: ReplaySource, evalCaseRunId: string): JudgeCaseLinkage {
  if (source.kind === 'live') {
    return {
      evalCaseRunId,
      expected: source.evalCase.expected ?? null,
      assertions: parseCaseAssertionRefs(source.evalCase.assertions),
    }
  }
  return {
    evalCaseRunId,
    expected: source.manifestCase.expected,
    assertions: parseCaseAssertionRefs(source.manifestCase.assertions),
    frozenAssertions: resolveManifestCaseAssertions(source.manifest, source.manifestCase)
      .filter((entry) => entry.assertion.type === 'llm_judge')
      .map((entry) => ({
        id: entry.assertion.id,
        key: entry.assertion.key,
        severity: entry.assertion.severity,
        rubric: entry.configError ? null : entry.rubric,
      })),
  }
}

async function deterministicAssertionsFor(
  em: EntityManager,
  source: ReplaySource,
  agentId: string,
  scope: EvalScope,
): Promise<ReplayAssertion[]> {
  if (source.kind === 'manifest') {
    return resolveManifestCaseAssertions(source.manifest, source.manifestCase)
      .filter((entry) => entry.assertion.type === 'deterministic')
      .map((entry) => ({
        id: entry.assertion.id,
        key: entry.assertion.key,
        severity: entry.assertion.severity,
        scorerKey: entry.assertion.scorerKey,
        config: entry.config,
        ...(entry.configError ? { configError: entry.configError } : {}),
      }))
  }
  const assertions = await em.find(AgentEvalAssertion, {
    ...scope,
    type: 'deterministic',
    enabled: true,
    deletedAt: null,
    appliesTo: { $in: [agentId, '*'] },
  })
  return resolveEffectiveAssertions(assertions, parseCaseAssertionRefs(source.evalCase.assertions)).map((entry) => ({
    id: entry.assertion.id,
    key: entry.assertion.key,
    severity: entry.assertion.severity,
    scorerKey: entry.scorerKey,
    config: entry.config,
    ...(entry.configError ? { configError: entry.configError } : {}),
  }))
}

/**
 * Executes ONE pending case run: replays the case's input through the real agent
 * runtime, then scores the resulting run.
 *
 * Replay performs FRESH INFERENCE. Scoring a stored output would not detect
 * regressions, which is the entire point of the eval plane.
 *
 * Propose-only by construction: this calls `agentRuntime.run` directly and never
 * `dispositionService.dispose`, so an `proposal` result is recorded as a
 * proposal but never executed. Those proposals are stamped `source: 'eval'` so the
 * operator caseload excludes them.
 */
export async function executeCaseRun(
  container: AwilixContainer,
  caseRunId: string,
  scope: EvalScope,
  userId: string,
  unresolvedVersions?: Set<string>,
): Promise<ReplayCaseOutcome> {
  const result = await runCase(container, caseRunId, scope, userId, unresolvedVersions)

  // Emitted on EVERY terminal path — including the error ones — so a failing case
  // still advances the live progress UI instead of leaving it hanging. Re-read
  // rather than threaded through five exit points: one cheap query buys a single
  // emission site that cannot be forgotten when a new exit path is added.
  const em = (container.resolve('em') as EntityManager).fork()
  const finished = await em.findOne(AgentEvalCaseRun, { id: caseRunId, ...scope })
  if (finished) {
    const evalCase = await em.findOne(AgentEvalCase, { id: finished.evalCaseId, ...scope })
    await emitCaseProgress('completed', finished, evalCase?.agentDefinitionId ?? '', scope)
  }
  return result
}

async function runCase(
  container: AwilixContainer,
  caseRunId: string,
  scope: EvalScope,
  userId: string,
  unresolvedVersions?: Set<string>,
): Promise<ReplayCaseOutcome> {
  const em = (container.resolve('em') as EntityManager).fork()

  const caseRun = await em.findOne(AgentEvalCaseRun, { id: caseRunId, ...scope })
  if (!caseRun) throw new Error('[internal] eval case run not found')

  const suiteRun = await findOneWithDecryption(
    em,
    AgentEvalSuiteRun,
    { id: caseRun.suiteRunId, ...scope },
    undefined,
    scope,
  )
  const suiteManifest = await loadSuiteManifest(em, suiteRun, scope, unresolvedVersions)

  let source: ReplaySource
  if (suiteManifest.pinned) {
    if (!suiteManifest.manifest) {
      return finishCaseRun(em, caseRun, {
        status: 'error',
        errorMessage: `[internal] ${EVAL_SET_UNRESOLVED}: the frozen eval set of this suite run could not be resolved`,
      })
    }
    const manifestCase = suiteManifest.manifest.cases.find((entry) => entry.id === caseRun.evalCaseId)
    if (!manifestCase) {
      return finishCaseRun(em, caseRun, {
        status: 'error',
        errorMessage: `[internal] ${EVAL_SET_CASE_MISSING}: the case is not part of the frozen eval set`,
      })
    }
    source = { kind: 'manifest', manifest: suiteManifest.manifest, manifestCase }
  } else {
    const evalCase = await findOneWithDecryption(
      em,
      AgentEvalCase,
      { id: caseRun.evalCaseId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!evalCase) {
      return finishCaseRun(em, caseRun, { status: 'error', errorMessage: '[internal] eval case not found' })
    }
    source = { kind: 'live', evalCase }
  }
  const agentDefinitionId = sourceAgentId(source)

  caseRun.status = 'running'
  await em.flush()
  await emitCaseProgress('started', caseRun, agentDefinitionId, scope)

  // Capture the FIRST run id only: nested sub-agent delegations fire the same hook.
  let topLevelRunId: string | null = null
  const runtime = container.resolve('agentRuntime') as AgentRuntimeLike

  // Run under the AGENT'S OWN principal, exactly as production does. Replaying
  // under the operator's identity would give the agent a different tool surface
  // and a different write guard than the configuration being measured, which
  // would quietly invalidate the regression signal.
  const principal = await em.findOne(AgentPrincipal, {
    agentDefinitionId,
    ...scope,
    enabled: true,
    deletedAt: null,
  })
  const actingUserId = principal?.userId ?? userId

  try {
    await runtime.run(agentDefinitionId, sourceInput(source), {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: actingUserId,
      // No principal provisioned yet (legacy/playground agents): fall back to the
      // operator's identity rather than refusing to run, and leave `runAs` unset
      // so nothing is misattributed to an agent that has none.
      ...(principal ? { runAs: { agentUserId: principal.userId, onBehalfOfUserId: userId } } : {}),
      // Tags THIS run and its proposal at creation, closing the window in which a
      // replay proposal would otherwise be broadcast and rendered as operator work.
      //
      // LIMITATION: nested sub-agent delegations do NOT inherit this — the
      // `delegate_agent` tool builds a fresh ctx and does not forward `source`
      // (ai-tools.ts). Those child runs are stamped `runtime` and are therefore
      // counted in the agent's production metric rollups. They cannot produce a
      // disposable proposal (delegation targets are researcher-only), so the
      // propose-only guarantee still holds; the labelling does not.
      source: 'eval',
      onRunPersisted: (runId: string) => {
        if (!topLevelRunId) topLevelRunId = runId
      },
    })
  } catch (error) {
    // A guardrail block, capacity refusal, timeout or invalid output fails THIS
    // case only — never the suite.
    return finishCaseRun(em, caseRun, {
      status: 'error',
      agentRunId: topLevelRunId,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }

  if (!topLevelRunId) {
    return finishCaseRun(em, caseRun, { status: 'error', errorMessage: '[internal] run produced no run id' })
  }

  const outcome = await scoreCaseRun(em, caseRun, source, topLevelRunId, scope)

  // Judge assertions run on their own async path AFTER the deterministic tier,
  // because a verdict needs a model round-trip. The suite's stored policy decides
  // whether a judge may gate: a human reads a manual run, so a rubric can decide
  // pass/fail there; CI and online ingest never let a stochastic verdict move a
  // gate. Best-effort — a judge failure must not fail an otherwise scored case.
  try {
    await runLlmJudgeForRun(
      em,
      scope,
      topLevelRunId,
      createModelJudge(container),
      { judgeMayGate: suiteRun?.judgeMayGate ?? false },
      judgeLinkageFor(source, caseRun.id),
    )
  } catch (error) {
    // Log the SHAPE of the failure, never the error object. Vercel AI SDK errors
    // carry `requestBodyValues.prompt` as an own enumerable property, and that
    // prompt embeds the decrypted agent output and expected value — console
    // serialization would push both past the tenant encryption boundary into the
    // log aggregator, once per failing case.
    logger.warn('llm_judge scoring failed during replay', {
      caseRunId: caseRun.id,
      errorName: error instanceof Error ? error.name : 'unknown',
    })
  }

  return outcome
}

async function scoreCaseRun(
  em: EntityManager,
  caseRun: AgentEvalCaseRun,
  source: ReplaySource,
  runId: string,
  scope: EvalScope,
): Promise<ReplayCaseOutcome> {
  const run = await findOneWithDecryption(em, AgentRun, { id: runId, ...scope }, undefined, scope)
  if (!run) {
    return finishCaseRun(em, caseRun, { status: 'error', agentRunId: runId, errorMessage: '[internal] run row missing' })
  }

  const toolCalls = await findWithDecryption(em, AgentToolCall, { agentRunId: run.id, ...scope }, undefined, scope)
  const spans = await em.find(AgentSpan, { agentRunId: run.id, ...scope })
  // Already stamped `source: 'eval'` at creation via the run ctx — read here only
  // for the `disposition_equals` scorer.
  const proposal = await em.findOne(AgentProposal, { runId: run.id, ...scope })

  const runView = projectRunView({ run, toolCalls, spans, disposition: proposal?.disposition ?? null })

  // Deterministic only: judge assertions need an async model round-trip and are
  // scored on their own path (Phase 3), not by this synchronous replay.
  const resolved = await deterministicAssertionsFor(em, source, run.agentId, scope)
  const expected = sourceExpected(source)

  const verdicts: Array<{ severity: 'gate' | 'warn'; passed: boolean | null; score: number | null }> = []

  for (const entry of resolved) {
    const verdict = entry.configError
      ? { passed: null, score: null, evidence: { reason: SKIP_REASON.invalidConfig, issues: entry.configError } as Json }
      : runScorer(entry.scorerKey, runView, expected, entry.config)

    em.persist(
      em.create(AgentEvalResult, {
        ...scope,
        agentRunId: run.id,
        evalCaseRunId: caseRun.id,
        assertionId: entry.id,
        assertionKey: entry.key,
        passed: verdict.passed,
        score: verdict.score,
        severity: entry.severity,
        evidence: verdict.evidence ?? null,
      }),
    )
    verdicts.push({ severity: entry.severity, passed: verdict.passed, score: verdict.score })
  }
  await withRuntimeAuditWrite(() => em.flush())

  const applied = verdicts.filter((entry) => entry.passed !== null)
  const gate = applied.filter((entry) => entry.severity === 'gate')
  const scored = applied.filter((entry) => typeof entry.score === 'number')

  // Every assertion skipped is 'skipped', not 'passed'.
  const status: AgentEvalCaseRun['status'] = applied.length === 0
    ? 'skipped'
    : gate.length
      ? gate.every((entry) => entry.passed === true) ? 'passed' : 'failed'
      : applied.every((entry) => entry.passed === true) ? 'passed' : 'failed'

  return finishCaseRun(em, caseRun, {
    status,
    agentRunId: run.id,
    passed: applied.length === 0 ? null : status === 'passed',
    score: scored.length
      ? scored.reduce((sum, entry) => sum + (entry.score as number), 0) / scored.length
      : null,
    latencyMs: run.latencyMs ?? null,
    costMinor: run.costMinor ?? null,
  })
}

async function finishCaseRun(
  em: EntityManager,
  caseRun: AgentEvalCaseRun,
  patch: {
    status: AgentEvalCaseRun['status']
    agentRunId?: string | null
    passed?: boolean | null
    score?: number | null
    latencyMs?: number | null
    costMinor?: number | null
    errorMessage?: string | null
  },
): Promise<ReplayCaseOutcome> {
  caseRun.status = patch.status
  caseRun.agentRunId = patch.agentRunId ?? caseRun.agentRunId ?? null
  caseRun.passed = patch.passed ?? null
  caseRun.score = patch.score ?? null
  caseRun.latencyMs = patch.latencyMs ?? null
  caseRun.costMinor = patch.costMinor ?? null
  caseRun.errorMessage = patch.errorMessage ?? null
  await em.flush()
  return { caseRunId: caseRun.id, status: caseRun.status, passed: caseRun.passed ?? null, score: caseRun.score ?? null }
}

/**
 * Per-assertion outcome bucket. `passRate` is over APPLIED results only (skipped
 * excluded), which is what makes two suite runs comparable even when a different
 * number of assertions applied to each.
 */
export type AssertionBucket = {
  passed: number
  failed: number
  skipped: number
  severity: string
  /** Judge verdicts are reported against the baseline but NEVER counted as a regression. */
  judge: boolean
  passRate: number | null
}

export type SuiteAggregate = {
  caseCount: number
  errorCount: number
  passScore: number | null
  scoreVariance: number | null
  summary: Record<string, AssertionBucket>
}

export type BaselineComparison = {
  baselineSuiteRunId: string | null
  /** Gate-severity deterministic assertions that regressed. Non-empty ⇒ the caller blocks. */
  safetyRegressions: string[]
  /** Judge movement, reported for trend only — a stochastic verdict never blocks. */
  judgeDeltas: Record<string, number>
}

async function judgeAssertionIds(
  em: EntityManager,
  suiteRunId: string,
  results: ReadonlyArray<AgentEvalResult>,
  scope: EvalScope,
): Promise<Set<string>> {
  const suiteRun = await findOneWithDecryption(em, AgentEvalSuiteRun, { id: suiteRunId, ...scope }, undefined, scope)
  const suiteManifest = await loadSuiteManifest(em, suiteRun, scope)
  if (suiteManifest.pinned && suiteManifest.manifest) {
    return new Set(
      suiteManifest.manifest.assertions.filter((entry) => entry.type === 'llm_judge').map((entry) => entry.id),
    )
  }
  const assertionIds = Array.from(new Set(results.map((result) => result.assertionId)))
  const assertions = assertionIds.length
    ? await em.find(AgentEvalAssertion, { id: { $in: assertionIds }, ...scope })
    : []
  return new Set(assertions.filter((entry) => entry.type === 'llm_judge').map((entry) => entry.id))
}

/**
 * Aggregates the finished case runs of a suite. Errored case runs are excluded
 * from `passScore` and counted separately: an errored case is not a passing case,
 * and averaging it as zero would misrepresent both.
 */
export async function aggregateSuiteRun(
  em: EntityManager,
  suiteRunId: string,
  scope: EvalScope,
): Promise<SuiteAggregate> {
  const caseRuns = await em.find(AgentEvalCaseRun, { suiteRunId, ...scope })
  const errorCount = caseRuns.filter((entry) => entry.status === 'error').length

  const measurable = caseRuns.filter((entry) => entry.status === 'passed' || entry.status === 'failed')
  const passScore = measurable.length
    ? measurable.filter((entry) => entry.status === 'passed').length / measurable.length
    : null

  const scores = measurable.map((entry) => entry.score).filter((score): score is number => typeof score === 'number')
  const mean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
  const scoreVariance =
    mean !== null && scores.length > 1
      ? scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length
      : null

  // `evidence` is encrypted — read through the decrypting helper.
  const results = await findWithDecryption(
    em,
    AgentEvalResult,
    { ...scope, evalCaseRunId: { $in: caseRuns.map((entry) => entry.id) } },
    undefined,
    scope,
  )
  // Judge assertions must be distinguishable in the summary: with a manual gate
  // policy a judge result can carry severity 'gate', so severity alone no longer
  // separates the deterministic tier from the stochastic one.
  const judgeIds = await judgeAssertionIds(em, suiteRunId, results, scope)

  const summary: SuiteAggregate['summary'] = {}
  for (const result of results) {
    const bucket = summary[result.assertionKey] ?? {
      passed: 0,
      failed: 0,
      skipped: 0,
      severity: result.severity,
      judge: judgeIds.has(result.assertionId),
      passRate: null,
    }
    if (result.passed === null || result.passed === undefined) bucket.skipped += 1
    else if (result.passed) bucket.passed += 1
    else bucket.failed += 1
    summary[result.assertionKey] = bucket
  }
  for (const bucket of Object.values(summary)) {
    const applied = bucket.passed + bucket.failed
    bucket.passRate = applied ? bucket.passed / applied : null
  }

  return { caseCount: caseRuns.length, errorCount, passScore, scoreVariance, summary }
}

/** Runs every pending case run of a suite, sequentially. Phase 3 moves this to a worker. */
export async function replaySuiteRun(
  container: AwilixContainer,
  suiteRunId: string,
  scope: EvalScope,
  userId: string,
): Promise<void> {
  const em = (container.resolve('em') as EntityManager).fork()
  const suiteRun = await findOneWithDecryption(em, AgentEvalSuiteRun, { id: suiteRunId, ...scope }, undefined, scope)
  if (!suiteRun) throw new Error('[internal] eval suite run not found')

  // Mark the suite in-flight before the first case: without this the row stays
  // 'queued' for its whole life and `started_at` — which both GET routes
  // serialize — is null on every run ever written.
  if (suiteRun.status === 'queued') {
    suiteRun.status = 'running'
    suiteRun.startedAt = new Date()
    await em.flush()
  }

  const pending = await em.find(AgentEvalCaseRun, { suiteRunId, ...scope, status: 'pending' }, { orderBy: { createdAt: 'ASC' } })

  const unresolvedVersions = new Set<string>()
  for (const caseRun of pending) {
    if (suiteRun.status === 'cancelled') break
    await executeCaseRun(container, caseRun.id, scope, userId, unresolvedVersions)
    await em.refresh(suiteRun)
  }
}

/**
 * Finds the run this one should be compared against: the most recent COMPLETED
 * suite run for the same agent, excluding this one.
 *
 * When the current run pins an `evalSetVersion`, the baseline must pin the same
 * one — comparing pass rates across different datasets would report dataset
 * changes as agent regressions.
 */
export async function resolveBaselineSuiteRun(
  em: EntityManager,
  suiteRun: AgentEvalSuiteRun,
  scope: EvalScope,
): Promise<AgentEvalSuiteRun | null> {
  const where: Record<string, unknown> = {
    ...scope,
    agentDefinitionId: suiteRun.agentDefinitionId,
    status: 'completed',
    id: { $ne: suiteRun.id },
    createdAt: { $lt: suiteRun.createdAt },
  }
  if (suiteRun.evalSetVersion) where.evalSetVersion = suiteRun.evalSetVersion

  const previous = await em.find(AgentEvalSuiteRun, where, { orderBy: { createdAt: 'DESC' }, limit: 1 })
  return previous[0] ?? null
}

/**
 * Compares this run's per-assertion outcomes against the baseline.
 *
 * Two deliberately different treatments:
 *
 * - **Deterministic `gate` assertions** that got worse are SAFETY REGRESSIONS and
 *   block. Reproducible input, reproducible verdict — a drop is a real signal.
 * - **Judge assertions** only ever produce a reported delta. Gating CI on an
 *   absolute judge threshold is unstable because the judge is stochastic; the
 *   surveyed field (Braintrust's baseline diffing, Langfuse's RegressionError)
 *   converged on relative movement for exactly this reason, and even then a judge
 *   verdict never blocks a promotion here.
 */
export function compareToBaseline(
  current: SuiteAggregate['summary'],
  baseline: SuiteAggregate['summary'] | null,
  baselineSuiteRunId: string | null,
): BaselineComparison {
  const safetyRegressions: string[] = []
  const judgeDeltas: Record<string, number> = {}
  if (!baseline) return { baselineSuiteRunId, safetyRegressions, judgeDeltas }

  for (const [assertionKey, bucket] of Object.entries(current)) {
    const before = baseline[assertionKey]
    if (!before || before.passRate === null || bucket.passRate === null) continue

    if (bucket.judge) {
      const delta = bucket.passRate - before.passRate
      if (delta !== 0) judgeDeltas[assertionKey] = Number(delta.toFixed(4))
      continue
    }
    if (bucket.severity === 'gate' && bucket.passRate < before.passRate) {
      safetyRegressions.push(assertionKey)
    }
  }

  return { baselineSuiteRunId, safetyRegressions, judgeDeltas }
}
