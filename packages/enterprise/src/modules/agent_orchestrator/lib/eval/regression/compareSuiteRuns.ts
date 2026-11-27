import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentEvalCase, AgentEvalCaseRun, AgentEvalResult, AgentEvalSuiteRun } from '../../../data/entities'
import { compareToBaseline, type EvalScope } from '../evalReplayService'
import { readEvalSetPointer, resolveManifest, type EvalSetManifest } from '../manifest'
import {
  caseStatusOf,
  groupCaseRunsByCase,
  loadAssertions,
  loadSuite,
  summarizeBuckets,
  type AssertionInfo,
  type CaseRunStatusSummary,
  type LoadedSuite,
} from '../report/suiteAggregation'
import { loadSuiteAgentVersions } from './suiteAgentVersions'

export type CaseChange = 'regressed' | 'fixed' | 'changed' | 'added' | 'removed' | 'unchanged'

export const CASE_CHANGE_ORDER: ReadonlyArray<CaseChange> = ['regressed', 'fixed', 'changed', 'added', 'removed', 'unchanged']

export type SuiteRunSummary = {
  id: string
  agentDefinitionId: string
  status: AgentEvalSuiteRun['status']
  outcome: AgentEvalSuiteRun['outcome'] | null
  passScore: number | null
  caseCount: number
  errorCount: number
  evalSetVersion: string | null
  manifestHash: string | null
  agentVersions: Array<string | null>
  createdAt: string
  finishedAt: string | null
}

export type AssertionComparison = {
  key: string
  type: string
  severity: string
  judge: boolean
  basePassRate: number | null
  headPassRate: number | null
  delta: number | null
  regressed: boolean
}

export type FlippedAssertion = { key: string; base: boolean | null; head: boolean | null }

export type CaseComparison = {
  caseId: string
  key: string
  name: string | null
  change: CaseChange
  baseStatus: CaseRunStatusSummary
  headStatus: CaseRunStatusSummary
  baseScore: number | null
  headScore: number | null
  scoreDelta: number | null
  baseTrials: number
  headTrials: number
  baseAgentRunId: string | null
  headAgentRunId: string | null
  flippedAssertions: FlippedAssertion[]
}

export type SuiteRunComparison = {
  base: SuiteRunSummary
  head: SuiteRunSummary
  sameDataset: boolean | null
  passScoreDelta: number | null
  totals: Record<CaseChange, number>
  assertions: AssertionComparison[]
  cases: CaseComparison[]
}

export type CaseLabel = { key: string; name: string | null }

export type ComparisonSide = {
  suite: LoadedSuite
  summary: SuiteRunSummary
}

export class EvalCompareError extends Error {
  constructor(
    readonly code: 'not_found' | 'run_not_finished' | 'agent_mismatch',
    readonly status: 404 | 409 | 422,
  ) {
    super(`[internal] eval compare: ${code}`)
    this.name = 'EvalCompareError'
  }
}

function roundDelta(value: number): number {
  return Number(value.toFixed(4))
}

function deltaOf(head: number | null, base: number | null): number | null {
  return head !== null && base !== null ? roundDelta(head - base) : null
}

function meanScore(trials: ReadonlyArray<AgentEvalCaseRun>): number | null {
  const scores = trials.map((trial) => trial.score).filter((score): score is number => typeof score === 'number')
  return scores.length ? roundDelta(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null
}

/** Per-case verdict of one assertion over its trials: any applied failure → false, all applied passed → true, all skipped → null. */
export function caseAssertionVerdicts(
  trials: ReadonlyArray<AgentEvalCaseRun>,
  resultsByCaseRun: Map<string, AgentEvalResult[]>,
): Map<string, boolean | null> {
  const verdicts = new Map<string, boolean | null>()
  for (const trial of trials) {
    for (const result of resultsByCaseRun.get(trial.id) ?? []) {
      const previous = verdicts.has(result.assertionKey) ? verdicts.get(result.assertionKey) ?? null : null
      const passed = result.passed ?? null
      if (passed === null) {
        if (!verdicts.has(result.assertionKey)) verdicts.set(result.assertionKey, null)
        continue
      }
      verdicts.set(result.assertionKey, previous === false ? false : passed)
    }
  }
  return verdicts
}

function groupResultsByCaseRun(results: ReadonlyArray<AgentEvalResult>): Map<string, AgentEvalResult[]> {
  const byCaseRun = new Map<string, AgentEvalResult[]>()
  for (const result of results) {
    if (!result.evalCaseRunId) continue
    const bucket = byCaseRun.get(result.evalCaseRunId) ?? []
    bucket.push(result)
    byCaseRun.set(result.evalCaseRunId, bucket)
  }
  return byCaseRun
}

export function classifyCaseChange(input: {
  baseStatus: CaseRunStatusSummary
  headStatus: CaseRunStatusSummary
  scoreDelta: number | null
  flippedCount: number
}): CaseChange {
  const { baseStatus, headStatus } = input
  if (baseStatus === 'absent') return 'added'
  if (headStatus === 'absent') return 'removed'
  const headBroken = headStatus === 'failed' || headStatus === 'error'
  const baseBroken = baseStatus === 'failed' || baseStatus === 'error'
  if (baseStatus === 'passed' && headBroken) return 'regressed'
  if (baseBroken && headStatus === 'passed') return 'fixed'
  if (baseStatus === headStatus && !input.flippedCount && (input.scoreDelta === null || input.scoreDelta === 0)) {
    return 'unchanged'
  }
  return 'changed'
}

function firstAgentRunId(trials: ReadonlyArray<AgentEvalCaseRun>): string | null {
  return trials.find((trial) => trial.agentRunId)?.agentRunId ?? null
}

/**
 * Pure per-case and per-assertion diff of two loaded suite runs. Pass rates and
 * case statuses use the same aggregation as the eval report; `regressed` on an
 * assertion is `compareToBaseline`'s safety regression (a deterministic gate
 * assertion whose pass rate dropped). Judge movement is reported, never flagged.
 */
export function diffSuiteRuns(
  base: ComparisonSide,
  head: ComparisonSide,
  assertionsById: Map<string, AssertionInfo>,
  labels: Map<string, CaseLabel>,
): SuiteRunComparison {
  const baseBuckets = summarizeBuckets(base.suite.results, assertionsById)
  const headBuckets = summarizeBuckets(head.suite.results, assertionsById)
  const baseline = compareToBaseline(headBuckets, baseBuckets, base.summary.id)
  const regressions = new Set(baseline.safetyRegressions)

  const typeByKey = new Map<string, string>()
  for (const result of [...base.suite.results, ...head.suite.results]) {
    if (!typeByKey.has(result.assertionKey)) {
      typeByKey.set(result.assertionKey, assertionsById.get(result.assertionId)?.type ?? 'unknown')
    }
  }
  const assertionKeys = Array.from(new Set([...Object.keys(baseBuckets), ...Object.keys(headBuckets)])).sort((left, right) =>
    left.localeCompare(right),
  )
  const assertions: AssertionComparison[] = assertionKeys.map((key) => {
    const before = baseBuckets[key]
    const after = headBuckets[key]
    const bucket = after ?? before
    const basePassRate = before?.passRate ?? null
    const headPassRate = after?.passRate ?? null
    return {
      key,
      type: typeByKey.get(key) ?? 'unknown',
      severity: bucket.severity,
      judge: bucket.judge,
      basePassRate,
      headPassRate,
      delta: deltaOf(headPassRate, basePassRate),
      regressed: regressions.has(key),
    }
  })

  const baseTrials = groupCaseRunsByCase(base.suite.caseRuns)
  const headTrials = groupCaseRunsByCase(head.suite.caseRuns)
  const baseResults = groupResultsByCaseRun(base.suite.results)
  const headResults = groupResultsByCaseRun(head.suite.results)
  const caseIds = Array.from(new Set([...baseTrials.keys(), ...headTrials.keys()]))

  const totals: Record<CaseChange, number> = { regressed: 0, fixed: 0, changed: 0, added: 0, removed: 0, unchanged: 0 }
  const cases: CaseComparison[] = caseIds.map((caseId) => {
    const before = baseTrials.get(caseId) ?? []
    const after = headTrials.get(caseId) ?? []
    const baseStatus = caseStatusOf(before)
    const headStatus = caseStatusOf(after)
    const baseScore = meanScore(before)
    const headScore = meanScore(after)
    const scoreDelta = deltaOf(headScore, baseScore)
    const flippedAssertions: FlippedAssertion[] = []
    if (before.length && after.length) {
      const baseVerdicts = caseAssertionVerdicts(before, baseResults)
      const headVerdicts = caseAssertionVerdicts(after, headResults)
      const keys = Array.from(new Set([...baseVerdicts.keys(), ...headVerdicts.keys()])).sort((left, right) =>
        left.localeCompare(right),
      )
      for (const key of keys) {
        const baseVerdict = baseVerdicts.has(key) ? baseVerdicts.get(key) ?? null : null
        const headVerdict = headVerdicts.has(key) ? headVerdicts.get(key) ?? null : null
        if (baseVerdict !== headVerdict) flippedAssertions.push({ key, base: baseVerdict, head: headVerdict })
      }
    }
    const change = classifyCaseChange({ baseStatus, headStatus, scoreDelta, flippedCount: flippedAssertions.length })
    totals[change] += 1
    const label = labels.get(caseId)
    return {
      caseId,
      key: label?.key ?? caseId,
      name: label?.name ?? null,
      change,
      baseStatus,
      headStatus,
      baseScore,
      headScore,
      scoreDelta,
      baseTrials: before.length,
      headTrials: after.length,
      baseAgentRunId: firstAgentRunId(before),
      headAgentRunId: firstAgentRunId(after),
      flippedAssertions,
    }
  })
  cases.sort((left, right) => {
    const byChange = CASE_CHANGE_ORDER.indexOf(left.change) - CASE_CHANGE_ORDER.indexOf(right.change)
    return byChange !== 0 ? byChange : left.key.localeCompare(right.key)
  })

  const baseHash = base.summary.manifestHash
  const headHash = head.summary.manifestHash
  return {
    base: base.summary,
    head: head.summary,
    sameDataset: baseHash !== null && headHash !== null ? baseHash === headHash : null,
    passScoreDelta: deltaOf(head.summary.passScore, base.summary.passScore),
    totals,
    assertions,
    cases,
  }
}

function toSummary(run: AgentEvalSuiteRun, agentVersions: Array<string | null>): SuiteRunSummary {
  return {
    id: run.id,
    agentDefinitionId: run.agentDefinitionId,
    status: run.status,
    outcome: run.outcome ?? null,
    passScore: run.passScore ?? null,
    caseCount: run.caseCount,
    errorCount: run.errorCount,
    evalSetVersion: run.evalSetVersion ?? null,
    manifestHash: readEvalSetPointer(run.summary)?.version ?? null,
    agentVersions,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  }
}

async function manifestOf(em: EntityManager, scope: EvalScope, run: AgentEvalSuiteRun): Promise<EvalSetManifest | null> {
  const pointer = readEvalSetPointer(run.summary)
  return pointer ? resolveManifest(em, scope, run.agentDefinitionId, pointer.version) : null
}

/**
 * Loads two suite runs of the same agent (tenant- and organization-scoped) and
 * diffs them. Throws `EvalCompareError` for a run out of scope (404), a run
 * still queued/running (409) or runs of different agents (422).
 */
export async function compareSuiteRuns(
  em: EntityManager,
  scope: EvalScope,
  baseId: string,
  headId: string,
): Promise<SuiteRunComparison> {
  const baseRun = await findOneWithDecryption(em, AgentEvalSuiteRun, { id: baseId, ...scope }, undefined, scope)
  const headRun = await findOneWithDecryption(em, AgentEvalSuiteRun, { id: headId, ...scope }, undefined, scope)
  if (!baseRun || !headRun) throw new EvalCompareError('not_found', 404)
  const active = (run: AgentEvalSuiteRun) => run.status === 'queued' || run.status === 'running'
  if (active(baseRun) || active(headRun)) throw new EvalCompareError('run_not_finished', 409)
  if (baseRun.agentDefinitionId !== headRun.agentDefinitionId) throw new EvalCompareError('agent_mismatch', 422)

  const baseSuite = await loadSuite(em, scope, baseRun.id)
  const headSuite = await loadSuite(em, scope, headRun.id)
  const versions = await loadSuiteAgentVersions(em, scope, [baseRun.id, headRun.id])
  const baseManifest = await manifestOf(em, scope, baseRun)
  const headManifest = await manifestOf(em, scope, headRun)

  const assertionsById = await loadAssertions(em, scope, [...baseSuite.results, ...headSuite.results], headManifest)
  for (const assertion of baseManifest?.assertions ?? []) {
    if (!assertionsById.has(assertion.id)) assertionsById.set(assertion.id, assertion)
  }

  const caseIds = Array.from(new Set([...baseSuite.caseRuns, ...headSuite.caseRuns].map((entry) => entry.evalCaseId)))
  const labels = new Map<string, CaseLabel>()
  for (const manifest of [baseManifest, headManifest]) {
    for (const entry of manifest?.cases ?? []) labels.set(entry.id, { key: entry.key, name: entry.name ?? null })
  }
  const missing = caseIds.filter((id) => !labels.has(id))
  if (missing.length) {
    const rows = await findWithDecryption(em, AgentEvalCase, { id: { $in: missing }, ...scope }, undefined, scope)
    for (const row of rows) labels.set(row.id, { key: row.id, name: row.name ?? null })
  }

  return diffSuiteRuns(
    { suite: baseSuite, summary: toSummary(baseRun, versions.get(baseRun.id) ?? []) },
    { suite: headSuite, summary: toSummary(headRun, versions.get(headRun.id) ?? []) },
    assertionsById,
    labels,
  )
}
