import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentEvalAssertion,
  AgentEvalCase,
  AgentEvalCaseRun,
  AgentEvalResult,
  AgentEvalSuiteRun,
  AgentRun,
} from '../../../data/entities'
import {
  compareToBaseline,
  resolveBaselineSuiteRun,
  type AssertionBucket,
  type EvalScope,
  type SuiteAggregate,
} from '../evalReplayService'
import type { Json } from '../types'
import { detectFlaky } from './flaky'
import {
  EVAL_REPORT_SCHEMA,
  EVAL_REPORT_SCHEMA_VERSION,
  type EvalReport,
  type EvalReportAssertion,
  type EvalReportCase,
  type EvalReportResult,
  type EvalReportStatus,
  type EvalReportTrial,
} from './reportSchema'

export const EVAL_REPORT_EVIDENCE_MAX_CHARS_DEFAULT = 2000
const HASH_PIN_PREFIX = 'sha256:'

export type BuildEvalReportOptions = {
  includePayloads?: boolean
  partial?: boolean
  evidenceMaxChars?: number
  cliVersion?: string | null
  env?: Record<string, string | undefined>
  now?: () => Date
}

export class EvalRunNotFinishedError extends Error {
  readonly code = 'run_not_finished'

  constructor(readonly suiteRunId: string) {
    super('[internal] eval suite run is not finished')
    this.name = 'EvalRunNotFinishedError'
  }
}

type BaselineStatus = EvalReportCase['baselineStatus']

type LoadedSuite = {
  caseRuns: AgentEvalCaseRun[]
  results: AgentEvalResult[]
}

function toIso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function reportStatus(status: AgentEvalSuiteRun['status']): EvalReportStatus {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status
  return 'running'
}

function pinKindOf(version: string | null): EvalReport['evalSet']['pinKind'] {
  if (!version) return 'none'
  return version.startsWith(HASH_PIN_PREFIX) ? 'hash' : 'label'
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null
}

function truncateText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value
}

export function truncateEvidence(evidence: unknown, maxChars: number): Json | null {
  if (evidence === null || evidence === undefined) return null
  const serialized = JSON.stringify(evidence)
  if (serialized === undefined) return null
  if (serialized.length <= maxChars) return JSON.parse(serialized) as Json
  return { truncated: true, excerpt: serialized.slice(0, maxChars) }
}

function toJson(value: unknown): Json | null {
  if (value === null || value === undefined) return null
  const serialized = JSON.stringify(value)
  return serialized === undefined ? null : (JSON.parse(serialized) as Json)
}

export function percentile(sortedValues: ReadonlyArray<number>, rank: number): number | null {
  if (!sortedValues.length) return null
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(rank * sortedValues.length) - 1))
  return sortedValues[index]
}

function sumOrNull(values: ReadonlyArray<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === 'number')
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null
}

function summarizeBuckets(
  results: ReadonlyArray<AgentEvalResult>,
  assertionsById: Map<string, AgentEvalAssertion>,
): SuiteAggregate['summary'] {
  const summary: SuiteAggregate['summary'] = {}
  for (const result of results) {
    const bucket: AssertionBucket = summary[result.assertionKey] ?? {
      passed: 0,
      failed: 0,
      skipped: 0,
      severity: result.severity,
      judge: assertionsById.get(result.assertionId)?.type === 'llm_judge',
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
  return summary
}

function baselineStatusOf(trials: ReadonlyArray<AgentEvalCaseRun>): BaselineStatus {
  if (!trials.length) return 'absent'
  if (trials.some((trial) => trial.status === 'failed')) return 'failed'
  if (trials.some((trial) => trial.status === 'passed')) return 'passed'
  if (trials.some((trial) => trial.status === 'error')) return 'error'
  return 'skipped'
}

async function loadSuite(em: EntityManager, scope: EvalScope, suiteRunId: string): Promise<LoadedSuite> {
  const caseRuns = await findWithDecryption(
    em,
    AgentEvalCaseRun,
    { suiteRunId, ...scope },
    { orderBy: { createdAt: 'ASC' } },
    scope,
  )
  const caseRunIds = caseRuns.map((entry) => entry.id)
  const results = caseRunIds.length
    ? await findWithDecryption(em, AgentEvalResult, { ...scope, evalCaseRunId: { $in: caseRunIds } }, undefined, scope)
    : []
  return { caseRuns, results }
}

async function loadAssertions(
  em: EntityManager,
  scope: EvalScope,
  results: ReadonlyArray<AgentEvalResult>,
): Promise<Map<string, AgentEvalAssertion>> {
  const assertionIds = Array.from(new Set(results.map((result) => result.assertionId)))
  if (!assertionIds.length) return new Map()
  const assertions = await findWithDecryption(em, AgentEvalAssertion, { id: { $in: assertionIds }, ...scope }, undefined, scope)
  return new Map(assertions.map((assertion) => [assertion.id, assertion]))
}

/**
 * Builds the portable, versioned report of ONE eval suite run (eval reports spec §a).
 *
 * Everything is read tenant- and organization-scoped through the decrypting
 * helpers. Case inputs and agent outputs are included only on explicit opt-in
 * (`includePayloads`); evidence excerpts are always included, truncated.
 *
 * Returns `null` when the run is not in scope. Throws `EvalRunNotFinishedError`
 * for a `queued`/`running` run unless `partial` is set.
 */
export async function buildEvalReport(
  em: EntityManager,
  scope: EvalScope,
  evalRunId: string,
  options: BuildEvalReportOptions = {},
): Promise<EvalReport | null> {
  const includePayloads = options.includePayloads === true
  const evidenceMaxChars = options.evidenceMaxChars ?? EVAL_REPORT_EVIDENCE_MAX_CHARS_DEFAULT
  const env = options.env ?? process.env

  const suiteRun = await findOneWithDecryption(em, AgentEvalSuiteRun, { id: evalRunId, ...scope }, undefined, scope)
  if (!suiteRun) return null
  const status = reportStatus(suiteRun.status)
  if (status === 'running' && options.partial !== true) throw new EvalRunNotFinishedError(suiteRun.id)

  const current = await loadSuite(em, scope, suiteRun.id)

  const baselineRun = suiteRun.baselineSuiteRunId
    ? await findOneWithDecryption(em, AgentEvalSuiteRun, { id: suiteRun.baselineSuiteRunId, ...scope }, undefined, scope)
    : status === 'running'
      ? await resolveBaselineSuiteRun(em, suiteRun, scope)
      : null
  const baseline = baselineRun ? await loadSuite(em, scope, baselineRun.id) : null

  const assertionsById = await loadAssertions(em, scope, [...current.results, ...(baseline?.results ?? [])])
  const currentBuckets = summarizeBuckets(current.results, assertionsById)
  const baselineBuckets = baseline ? summarizeBuckets(baseline.results, assertionsById) : null
  const comparison = compareToBaseline(currentBuckets, baselineBuckets, baselineRun?.id ?? null)

  const caseIds = Array.from(new Set(current.caseRuns.map((entry) => entry.evalCaseId)))
  const cases = caseIds.length
    ? await findWithDecryption(em, AgentEvalCase, { id: { $in: caseIds }, ...scope }, undefined, scope)
    : []
  const casesById = new Map(cases.map((entry) => [entry.id, entry]))

  const runIds = Array.from(
    new Set(current.caseRuns.map((entry) => entry.agentRunId).filter((id): id is string => typeof id === 'string')),
  )
  const runs = runIds.length
    ? await findWithDecryption(em, AgentRun, { id: { $in: runIds }, ...scope }, undefined, scope)
    : []
  const runsById = new Map(runs.map((run) => [run.id, run]))

  const resultsByCaseRun = new Map<string, AgentEvalResult[]>()
  for (const result of current.results) {
    if (!result.evalCaseRunId) continue
    const bucket = resultsByCaseRun.get(result.evalCaseRunId) ?? []
    bucket.push(result)
    resultsByCaseRun.set(result.evalCaseRunId, bucket)
  }

  const trialsByCase = new Map<string, AgentEvalCaseRun[]>()
  for (const caseRun of current.caseRuns) {
    const bucket = trialsByCase.get(caseRun.evalCaseId) ?? []
    bucket.push(caseRun)
    trialsByCase.set(caseRun.evalCaseId, bucket)
  }
  for (const trials of trialsByCase.values()) trials.sort((left, right) => left.trialIndex - right.trialIndex)

  const baselineTrialsByCase = new Map<string, AgentEvalCaseRun[]>()
  for (const caseRun of baseline?.caseRuns ?? []) {
    const bucket = baselineTrialsByCase.get(caseRun.evalCaseId) ?? []
    bucket.push(caseRun)
    baselineTrialsByCase.set(caseRun.evalCaseId, bucket)
  }

  const flaky = detectFlaky(
    suiteRun.repeatCount,
    caseIds.map((caseId) => ({
      caseId,
      trials: (trialsByCase.get(caseId) ?? []).map((trial) => ({
        status: trial.status,
        results: (resultsByCaseRun.get(trial.id) ?? []).map((result) => ({
          assertionKey: result.assertionKey,
          passed: result.passed ?? null,
        })),
      })),
    })),
  )

  const buildResult = (result: AgentEvalResult): EvalReportResult => {
    const assertion = assertionsById.get(result.assertionId)
    const evidence = readRecord(result.evidence)
    const feedback = readString(evidence?.feedback)
    const passed = result.passed ?? null
    return {
      assertionKey: result.assertionKey,
      scorerKey: assertion?.scorerKey ?? result.assertionKey,
      type: assertion?.type ?? 'unknown',
      severity: result.severity,
      passed,
      score: result.score ?? null,
      evidence: truncateEvidence(result.evidence, evidenceMaxChars),
      judgeFeedback: feedback ? truncateText(feedback, evidenceMaxChars) : null,
      skipReason: passed === null ? readString(evidence?.reason) : null,
    }
  }

  const buildTrial = (caseRun: AgentEvalCaseRun): EvalReportTrial => {
    const agentRunId = caseRun.agentRunId ?? null
    const trial: EvalReportTrial = {
      trialIndex: caseRun.trialIndex,
      caseRunId: caseRun.id,
      status: caseRun.status,
      score: caseRun.score ?? null,
      latencyMs: caseRun.latencyMs ?? null,
      costMinor: caseRun.costMinor ?? null,
      agentRunId,
      tracePath: agentRunId ? `/backend/traces/${agentRunId}` : null,
      error: caseRun.errorMessage ? truncateText(caseRun.errorMessage, evidenceMaxChars) : null,
      results: (resultsByCaseRun.get(caseRun.id) ?? [])
        .slice()
        .sort((left, right) => left.assertionKey.localeCompare(right.assertionKey))
        .map(buildResult),
    }
    if (includePayloads) trial.output = toJson(agentRunId ? runsById.get(agentRunId)?.output : null) ?? null
    return trial
  }

  const reportCases: EvalReportCase[] = caseIds.map((caseId) => {
    const evalCase = casesById.get(caseId)
    const reportCase: EvalReportCase = {
      id: caseId,
      key: caseId,
      name: evalCase?.name ?? null,
      source: 'db',
      flaky: flaky.flakyCaseIds.has(caseId),
      baselineStatus: baseline ? baselineStatusOf(baselineTrialsByCase.get(caseId) ?? []) : 'absent',
      trials: (trialsByCase.get(caseId) ?? []).map(buildTrial),
    }
    if (includePayloads) {
      reportCase.input = toJson(evalCase?.input) ?? null
      reportCase.expected = toJson(evalCase?.expected)
    }
    return reportCase
  })

  const regressions = new Set(comparison.safetyRegressions)
  const reportAssertions: EvalReportAssertion[] = Object.entries(currentBuckets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, bucket]) => {
      const sample = current.results.find((result) => result.assertionKey === key)
      const assertion = sample ? assertionsById.get(sample.assertionId) : undefined
      const baselinePassRate = baselineBuckets?.[key]?.passRate ?? null
      const delta = bucket.passRate !== null && baselinePassRate !== null
        ? Number((bucket.passRate - baselinePassRate).toFixed(4))
        : null
      return {
        key,
        scorerKey: assertion?.scorerKey ?? key,
        type: assertion?.type ?? 'unknown',
        severity: bucket.severity,
        passRate: bucket.passRate,
        passed: bucket.passed,
        failed: bucket.failed,
        skipped: bucket.skipped,
        baselinePassRate,
        delta,
        regressed: regressions.has(key),
        flaky: flaky.flakyAssertionKeys.has(key),
      }
    })

  const latencies = current.caseRuns
    .map((entry) => entry.latencyMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((left, right) => left - right)
  const currencies = Array.from(
    new Set(runs.map((run) => run.currency).filter((value): value is string => typeof value === 'string' && value.length > 0)),
  )
  const models = Array.from(
    new Set(runs.map((run) => run.model).filter((value): value is string => typeof value === 'string' && value.length > 0)),
  ).sort((left, right) => left.localeCompare(right))
  const countStatus = (target: AgentEvalCaseRun['status']) =>
    current.caseRuns.filter((entry) => entry.status === target).length
  const evalSetVersion = suiteRun.evalSetVersion ?? null
  const pinKind = pinKindOf(evalSetVersion)

  return {
    schema: EVAL_REPORT_SCHEMA,
    schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
    generatedAt: (options.now ? options.now() : new Date()).toISOString(),
    status,
    suiteRun: {
      id: suiteRun.id,
      agentId: suiteRun.agentDefinitionId,
      trigger: suiteRun.trigger,
      outcome: suiteRun.outcome ?? null,
      passScore: suiteRun.passScore ?? null,
      scoreVariance: suiteRun.scoreVariance ?? null,
      repeatCount: suiteRun.repeatCount,
      judgeMayGate: suiteRun.judgeMayGate,
      startedAt: toIso(suiteRun.startedAt),
      finishedAt: toIso(suiteRun.finishedAt),
      releaseId: suiteRun.releaseId ?? null,
    },
    evalSet: {
      version: evalSetVersion,
      pinKind,
      manifestHash: null,
      label: pinKind === 'label' ? evalSetVersion : null,
      source: 'db',
      caseCount: caseIds.length,
      assertionCount: Object.keys(currentBuckets).length,
    },
    baseline: {
      suiteRunId: baselineRun?.id ?? null,
      manifestHash: null,
      sameDataset: null,
      warnings: [],
    },
    environment: {
      models,
      modelSettings: {},
      toolMode: 'live',
      modelMode: env.OM_AI_PROVIDER === 'scripted' ? 'scripted' : 'live',
      gitSha: readString(env.GITHUB_SHA) ?? readString(env.OM_EVAL_GIT_SHA),
      cliVersion: options.cliVersion ?? null,
    },
    totals: {
      cases: caseIds.length,
      trials: current.caseRuns.length,
      passed: countStatus('passed'),
      failed: countStatus('failed'),
      errored: countStatus('error'),
      skipped: countStatus('skipped'),
      flakyCases: flaky.flakyCaseIds.size,
      costMinor: sumOrNull(current.caseRuns.map((entry) => entry.costMinor)),
      currency: currencies.length === 1 ? currencies[0] : null,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length ? latencies[latencies.length - 1] : null,
      },
      tokens: {
        input: sumOrNull(runs.map((run) => run.inputTokens)),
        output: sumOrNull(runs.map((run) => run.outputTokens)),
      },
    },
    assertions: reportAssertions,
    regressions: comparison.safetyRegressions,
    cases: reportCases,
  }
}
