import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentEvalCase,
  AgentEvalCaseRun,
  AgentEvalResult,
  AgentEvalSuiteRun,
  AgentRun,
} from '../../../data/entities'
import { compareToBaseline, resolveBaselineSuiteRun, type EvalScope } from '../evalReplayService'
import {
  EVAL_SET_UNRESOLVED,
  readEvalSetPointer,
  resolveManifest,
  type EvalSetManifest,
  type EvalSetManifestCase,
} from '../manifest'
import type { Json } from '../types'
import { detectFlaky } from './flaky'
import { readEvalRunCallSettings, readEvalRunToolMode, readEvalRunToolSummary } from '../evalRunSettings'
import { getAgentEntry } from '../../sdk/defineAgent'
import {
  buildEnvironmentWarnings,
  buildReportModelSettings,
  collectRunTreeIds,
  loadRecordedLlmCalls,
  providersOf,
  resolveEffectiveModelSettings,
  type RecordedLlmCall,
} from './reportEnvironment'
import { caseStatusOf, groupCaseRunsByCase, loadAssertions, loadSuite, summarizeBuckets } from './suiteAggregation'
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

function datasetDriftWarning(label: string, baselineHash: string, currentHash: string): string {
  return `dataset_drift: eval set label "${label}" froze manifest ${currentHash} but the baseline ran manifest ${baselineHash}`
}

function evalSetUnresolvedWarning(version: string): string {
  return `${EVAL_SET_UNRESOLVED}: the frozen eval set ${version} could not be resolved, so case names, inputs and expected values show the current case definitions`
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

  const pointer = readEvalSetPointer(suiteRun.summary)
  const manifest = pointer
    ? await resolveManifest(em, scope, suiteRun.agentDefinitionId, pointer.version)
    : null

  const assertionsById = await loadAssertions(
    em,
    scope,
    [...current.results, ...(baseline?.results ?? [])],
    manifest,
  )
  const currentBuckets = summarizeBuckets(current.results, assertionsById)
  const baselineBuckets = baseline ? summarizeBuckets(baseline.results, assertionsById) : null
  const comparison = compareToBaseline(currentBuckets, baselineBuckets, baselineRun?.id ?? null)

  const caseIds = Array.from(new Set(current.caseRuns.map((entry) => entry.evalCaseId)))
  const cases = caseIds.length
    ? await findWithDecryption(em, AgentEvalCase, { id: { $in: caseIds }, ...scope }, undefined, scope)
    : []
  const casesById = new Map(cases.map((entry) => [entry.id, entry]))

  const frozenCasesById = new Map<string, EvalSetManifestCase>(
    (manifest?.cases ?? []).map((entry) => [entry.id, entry]),
  )

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

  const trialsByCase = groupCaseRunsByCase(current.caseRuns)
  const baselineTrialsByCase = groupCaseRunsByCase(baseline?.caseRuns ?? [])

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
    const frozenCase = frozenCasesById.get(caseId)
    const reportCase: EvalReportCase = {
      id: caseId,
      key: frozenCase?.key ?? caseId,
      name: frozenCase ? frozenCase.name : evalCase?.name ?? null,
      source: frozenCase && manifest ? manifest.source : 'db',
      flaky: flaky.flakyCaseIds.has(caseId),
      baselineStatus: baseline ? caseStatusOf(baselineTrialsByCase.get(caseId) ?? []) : 'absent',
      trials: (trialsByCase.get(caseId) ?? []).map(buildTrial),
    }
    if (includePayloads) {
      reportCase.input = toJson(frozenCase ? frozenCase.input : evalCase?.input) ?? null
      reportCase.expected = toJson(frozenCase ? frozenCase.expected : evalCase?.expected)
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
  const effectiveModelSettings = resolveEffectiveModelSettings(
    getAgentEntry(suiteRun.agentDefinitionId)?.modelSettings,
    readEvalRunCallSettings(suiteRun.summary),
  )
  const recordedLlmCalls: RecordedLlmCall[] = runIds.length
    ? await loadRecordedLlmCalls(em, scope, await collectRunTreeIds(em, scope, runIds))
    : []
  const providers = providersOf(recordedLlmCalls)
  const toolSummary = readEvalRunToolSummary(suiteRun.summary)
  const environmentWarnings = buildEnvironmentWarnings(toolSummary)
  const countStatus = (target: AgentEvalCaseRun['status']) =>
    current.caseRuns.filter((entry) => entry.status === target).length
  const evalSetVersion = suiteRun.evalSetVersion ?? null
  const pinKind = pinKindOf(evalSetVersion)
  const manifestHash = pointer?.version ?? null
  const baselineManifestHash = baselineRun ? readEvalSetPointer(baselineRun.summary)?.version ?? null : null
  const sameDataset = manifestHash !== null && baselineManifestHash !== null ? manifestHash === baselineManifestHash : null
  const baselineWarnings =
    pinKind === 'label' && evalSetVersion !== null && sameDataset === false && manifestHash !== null && baselineManifestHash !== null
      ? [datasetDriftWarning(evalSetVersion, baselineManifestHash, manifestHash)]
      : []
  if (pointer && !manifest) baselineWarnings.push(evalSetUnresolvedWarning(pointer.version))

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
      manifestHash,
      label: pointer?.label ?? (pinKind === 'label' ? evalSetVersion : null),
      source: pointer?.source ?? 'db',
      caseCount: pointer?.caseCount ?? caseIds.length,
      assertionCount: pointer?.assertionCount ?? Object.keys(currentBuckets).length,
    },
    baseline: {
      suiteRunId: baselineRun?.id ?? null,
      manifestHash: baselineManifestHash,
      sameDataset,
      warnings: baselineWarnings,
    },
    environment: {
      models,
      modelSettings: buildReportModelSettings(effectiveModelSettings, recordedLlmCalls),
      ...(providers.length ? { providers } : {}),
      toolMode: readEvalRunToolMode(suiteRun.summary),
      modelMode: env.OM_AI_PROVIDER === 'scripted' ? 'scripted' : 'live',
      gitSha: readString(env.GITHUB_SHA) ?? readString(env.OM_EVAL_GIT_SHA),
      cliVersion: options.cliVersion ?? null,
      ...(environmentWarnings.length ? { warnings: environmentWarnings } : {}),
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
