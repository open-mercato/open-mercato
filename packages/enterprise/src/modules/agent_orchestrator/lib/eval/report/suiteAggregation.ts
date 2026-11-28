import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentEvalAssertion, AgentEvalCaseRun, AgentEvalResult } from '../../../data/entities'
import type { AssertionBucket, EvalScope, SuiteAggregate } from '../evalReplayService'
import type { EvalSetManifest } from '../manifest'

/**
 * Aggregation shared by the eval report (`buildEvalReport`) and the regression
 * dashboard (`compareSuiteRuns`, `buildEvalTrend`), so both always agree on a
 * pass rate, a case status and a regression.
 */

export type CaseRunStatusSummary = 'passed' | 'failed' | 'error' | 'skipped' | 'absent'

export type AssertionInfo = { scorerKey: string; type: string }

export type LoadedSuite = {
  caseRuns: AgentEvalCaseRun[]
  results: AgentEvalResult[]
}

export function summarizeBuckets(
  results: ReadonlyArray<AgentEvalResult>,
  assertionsById: Map<string, AssertionInfo>,
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

/** One status for all trials of a case: any failure wins, then any pass, then any error. */
export function caseStatusOf(trials: ReadonlyArray<Pick<AgentEvalCaseRun, 'status'>>): CaseRunStatusSummary {
  if (!trials.length) return 'absent'
  if (trials.some((trial) => trial.status === 'failed')) return 'failed'
  if (trials.some((trial) => trial.status === 'passed')) return 'passed'
  if (trials.some((trial) => trial.status === 'error')) return 'error'
  return 'skipped'
}

export function groupCaseRunsByCase(caseRuns: ReadonlyArray<AgentEvalCaseRun>): Map<string, AgentEvalCaseRun[]> {
  const byCase = new Map<string, AgentEvalCaseRun[]>()
  for (const caseRun of caseRuns) {
    const bucket = byCase.get(caseRun.evalCaseId) ?? []
    bucket.push(caseRun)
    byCase.set(caseRun.evalCaseId, bucket)
  }
  for (const trials of byCase.values()) trials.sort((left, right) => left.trialIndex - right.trialIndex)
  return byCase
}

export async function loadSuite(em: EntityManager, scope: EvalScope, suiteRunId: string): Promise<LoadedSuite> {
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

export async function loadAssertions(
  em: EntityManager,
  scope: EvalScope,
  results: ReadonlyArray<AgentEvalResult>,
  manifest: EvalSetManifest | null,
): Promise<Map<string, AssertionInfo>> {
  const assertionIds = Array.from(new Set(results.map((result) => result.assertionId)))
  if (!assertionIds.length) return new Map()
  const assertions = await findWithDecryption(em, AgentEvalAssertion, { id: { $in: assertionIds }, ...scope }, undefined, scope)
  const byId = new Map<string, AssertionInfo>(
    (manifest?.assertions ?? []).map((assertion) => [assertion.id, assertion]),
  )
  for (const assertion of assertions) byId.set(assertion.id, assertion)
  return byId
}
