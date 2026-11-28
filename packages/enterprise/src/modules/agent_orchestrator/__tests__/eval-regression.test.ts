import { AgentEvalCaseRun, AgentEvalResult } from '../data/entities'
import {
  caseAssertionVerdicts,
  classifyCaseChange,
  diffSuiteRuns,
  type CaseLabel,
  type ComparisonSide,
  type SuiteRunSummary,
} from '../lib/eval/regression/compareSuiteRuns'
import { computeEvalTrend, datasetKeyOf, type EvalTrendRunInput } from '../lib/eval/regression/buildEvalTrend'
import type { AssertionInfo } from '../lib/eval/report/suiteAggregation'

let sequence = 0

function caseRun(fields: Partial<AgentEvalCaseRun> & Pick<AgentEvalCaseRun, 'evalCaseId' | 'status'>): AgentEvalCaseRun {
  sequence += 1
  return Object.assign(new AgentEvalCaseRun(), {
    id: `case-run-${sequence}`,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    suiteRunId: 'suite',
    agentRunId: `agent-run-${sequence}`,
    trialIndex: 0,
    score: fields.status === 'passed' ? 1 : 0,
    ...fields,
  })
}

function result(trial: AgentEvalCaseRun, assertionKey: string, passed: boolean | null, severity: 'gate' | 'warn' = 'gate'): AgentEvalResult {
  return Object.assign(new AgentEvalResult(), {
    id: `${trial.id}-${assertionKey}`,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentRunId: trial.agentRunId ?? 'agent-run',
    assertionId: `assertion-${assertionKey}`,
    assertionKey,
    evalCaseRunId: trial.id,
    passed,
    severity,
  })
}

function summary(id: string, passScore: number | null, manifestHash: string | null, agentVersions: string[]): SuiteRunSummary {
  return {
    id,
    agentDefinitionId: 'agent.one',
    status: 'completed',
    outcome: 'passed',
    passScore,
    caseCount: 3,
    errorCount: 0,
    evalSetVersion: null,
    manifestHash,
    agentVersions,
    createdAt: '2026-11-01T00:00:00.000Z',
    finishedAt: '2026-11-01T00:01:00.000Z',
  }
}

describe('classifyCaseChange', () => {
  it.each([
    ['absent', 'passed', 'added'],
    ['passed', 'absent', 'removed'],
    ['passed', 'failed', 'regressed'],
    ['passed', 'error', 'regressed'],
    ['failed', 'passed', 'fixed'],
    ['error', 'passed', 'fixed'],
    ['failed', 'error', 'changed'],
    ['skipped', 'passed', 'changed'],
    ['passed', 'passed', 'unchanged'],
  ] as const)('%s → %s is %s', (baseStatus, headStatus, expected) => {
    expect(classifyCaseChange({ baseStatus, headStatus, scoreDelta: 0, flippedCount: 0 })).toBe(expected)
  })

  it('reports a same-status case whose score or verdicts moved as changed', () => {
    expect(classifyCaseChange({ baseStatus: 'passed', headStatus: 'passed', scoreDelta: -0.25, flippedCount: 0 })).toBe('changed')
    expect(classifyCaseChange({ baseStatus: 'failed', headStatus: 'failed', scoreDelta: 0, flippedCount: 1 })).toBe('changed')
  })
})

describe('caseAssertionVerdicts', () => {
  it('fails an assertion when any applied trial failed it and ignores skipped trials', () => {
    const first = caseRun({ evalCaseId: 'c1', status: 'passed', trialIndex: 0 })
    const second = caseRun({ evalCaseId: 'c1', status: 'failed', trialIndex: 1 })
    const byCaseRun = new Map([
      [first.id, [result(first, 'a', true), result(first, 'b', null), result(first, 'c', true)]],
      [second.id, [result(second, 'a', false), result(second, 'b', null), result(second, 'c', null)]],
    ])
    const verdicts = caseAssertionVerdicts([first, second], byCaseRun)
    expect(verdicts.get('a')).toBe(false)
    expect(verdicts.get('b')).toBeNull()
    expect(verdicts.get('c')).toBe(true)
  })
})

describe('diffSuiteRuns', () => {
  function side(id: string, passScore: number, hash: string | null, version: string, rows: Array<[string, AgentEvalCaseRun['status'], Record<string, boolean | null>]>): ComparisonSide {
    const caseRuns: AgentEvalCaseRun[] = []
    const results: AgentEvalResult[] = []
    for (const [caseId, status, verdicts] of rows) {
      const trial = caseRun({ evalCaseId: caseId, status, suiteRunId: id })
      caseRuns.push(trial)
      for (const [key, passed] of Object.entries(verdicts)) results.push(result(trial, key, passed, key === 'judge' ? 'warn' : 'gate'))
    }
    return { suite: { caseRuns, results }, summary: summary(id, passScore, hash, [version]) }
  }

  const assertions = new Map<string, AssertionInfo>([
    ['assertion-schema', { scorerKey: 'json_schema', type: 'deterministic' }],
    ['assertion-judge', { scorerKey: 'llm_judge', type: 'llm_judge' }],
  ])
  const labels = new Map<string, CaseLabel>([
    ['c-regress', { key: 'regress', name: 'Regresses' }],
    ['c-fix', { key: 'fix', name: 'Gets fixed' }],
    ['c-stable', { key: 'stable', name: null }],
    ['c-gone', { key: 'gone', name: 'Removed' }],
    ['c-new', { key: 'new', name: 'Added' }],
  ])

  const base = side('base', 0.5, 'sha256:aaa', 'v1', [
    ['c-regress', 'passed', { schema: true, judge: true }],
    ['c-fix', 'failed', { schema: false, judge: false }],
    ['c-stable', 'passed', { schema: true, judge: true }],
    ['c-gone', 'failed', { schema: false, judge: true }],
  ])
  const head = side('head', 0.5, 'sha256:aaa', 'v2', [
    ['c-regress', 'failed', { schema: false, judge: false }],
    ['c-fix', 'passed', { schema: true, judge: true }],
    ['c-stable', 'passed', { schema: true, judge: true }],
    ['c-new', 'passed', { schema: true, judge: true }],
  ])

  const comparison = diffSuiteRuns(base, head, assertions, labels)

  it('classifies every case and sorts the changes first', () => {
    expect(comparison.cases.map((entry) => [entry.key, entry.change])).toEqual([
      ['regress', 'regressed'],
      ['fix', 'fixed'],
      ['new', 'added'],
      ['gone', 'removed'],
      ['stable', 'unchanged'],
    ])
    expect(comparison.totals).toEqual({ regressed: 1, fixed: 1, changed: 0, added: 1, removed: 1, unchanged: 1 })
  })

  it('lists the assertions that flipped on a case', () => {
    const regressed = comparison.cases.find((entry) => entry.key === 'regress')
    expect(regressed?.flippedAssertions).toEqual([
      { key: 'judge', base: true, head: false },
      { key: 'schema', base: true, head: false },
    ])
    expect(regressed?.scoreDelta).toBe(-1)
    expect(regressed?.baseAgentRunId).toBeTruthy()
    expect(comparison.cases.find((entry) => entry.key === 'new')?.flippedAssertions).toEqual([])
  })

  it('computes assertion deltas and never flags judge movement as a regression', () => {
    const schema = comparison.assertions.find((entry) => entry.key === 'schema')
    const judge = comparison.assertions.find((entry) => entry.key === 'judge')
    expect(schema).toMatchObject({ basePassRate: 0.5, headPassRate: 0.75, delta: 0.25, regressed: false, judge: false })
    expect(judge).toMatchObject({ basePassRate: 0.75, headPassRate: 0.75, delta: 0, regressed: false, judge: true })
  })

  it('flags a deterministic gate assertion whose pass rate dropped', () => {
    const worse = side('worse', 0.25, 'sha256:aaa', 'v3', [
      ['c-regress', 'failed', { schema: false }],
      ['c-fix', 'failed', { schema: false }],
      ['c-stable', 'passed', { schema: true }],
    ])
    const regression = diffSuiteRuns(base, worse, assertions, labels)
    expect(regression.assertions.find((entry) => entry.key === 'schema')).toMatchObject({ regressed: true, delta: -0.1667 })
    expect(regression.passScoreDelta).toBe(-0.25)
  })

  it('reports whether both runs used the same frozen dataset', () => {
    expect(comparison.sameDataset).toBe(true)
    const other = { ...head, summary: { ...head.summary, manifestHash: 'sha256:bbb' } }
    expect(diffSuiteRuns(base, other, assertions, labels).sameDataset).toBe(false)
    const unpinned = { ...head, summary: { ...head.summary, manifestHash: null } }
    expect(diffSuiteRuns(base, unpinned, assertions, labels).sameDataset).toBeNull()
  })
})

describe('computeEvalTrend', () => {
  function run(id: string, day: number, passScore: number | null, hash: string | null, versions: Array<string | null>): EvalTrendRunInput {
    return {
      suiteRunId: id,
      createdAt: new Date(Date.UTC(2026, 10, day)),
      finishedAt: new Date(Date.UTC(2026, 10, day, 1)),
      trigger: 'manual',
      outcome: 'passed',
      passScore,
      scoreVariance: null,
      caseCount: 4,
      errorCount: 0,
      evalSetVersion: null,
      manifestHash: hash,
      agentVersions: versions,
      safetyRegressionCount: 0,
    }
  }

  const trend = computeEvalTrend('agent.one', [
    run('r4', 4, 0.5, 'sha256:aaa', ['v2']),
    run('r1', 1, 1, 'sha256:aaa', ['v1']),
    run('r3', 3, 0.25, 'sha256:bbb', ['v2']),
    run('r2', 2, 0.75, 'sha256:aaa', ['v1']),
  ])

  it('orders points oldest first and connects deltas only within a dataset', () => {
    expect(trend.points.map((point) => [point.suiteRunId, point.previousSuiteRunId, point.passScoreDelta])).toEqual([
      ['r1', null, null],
      ['r2', 'r1', -0.25],
      ['r3', null, null],
      ['r4', 'r2', -0.25],
    ])
  })

  it('summarizes each agent version against the previous one on the same dataset', () => {
    expect(trend.versions).toEqual([
      expect.objectContaining({ agentVersion: 'v1', runCount: 2, latestSuiteRunId: 'r2', latestPassScore: 0.75, meanPassScore: 0.875, previousVersion: null, passScoreDelta: null }),
      expect.objectContaining({ agentVersion: 'v2', runCount: 2, latestSuiteRunId: 'r4', latestPassScore: 0.5, meanPassScore: 0.375, previousVersion: 'v1', passScoreDelta: -0.25, sameDataset: true }),
    ])
  })

  it('withholds a version delta across datasets and groups unversioned runs', () => {
    const mixed = computeEvalTrend('agent.one', [
      run('a', 1, 1, 'sha256:aaa', []),
      run('b', 2, 0.5, 'sha256:bbb', ['v2', 'v3']),
    ])
    expect(mixed.versions.map((entry) => [entry.agentVersion, entry.previousVersion, entry.passScoreDelta, entry.sameDataset])).toEqual([
      [null, null, null, null],
      ['v2', null, null, false],
      ['v3', null, null, false],
    ])
  })

  it('orders versions by latest run and compares each against the version it replaced in time', () => {
    const rollback = computeEvalTrend('agent.one', [
      run('r3', 3, 0.9, 'sha256:aaa', ['v1']),
      run('r1', 1, 0.9, 'sha256:aaa', ['v1']),
      run('r2', 2, 0.4, 'sha256:aaa', ['v2']),
    ])
    expect(
      rollback.versions.map((entry) => [entry.agentVersion, entry.latestSuiteRunId, entry.previousVersion, entry.passScoreDelta, entry.sameDataset]),
    ).toEqual([
      ['v2', 'r2', 'v1', -0.5, true],
      ['v1', 'r3', 'v2', 0.5, true],
    ])
  })

  it('leaves a version without an older run of another version unanchored', () => {
    const single = computeEvalTrend('agent.one', [
      run('r1', 1, 0.5, 'sha256:aaa', ['v1']),
      run('r2', 2, 0.75, 'sha256:aaa', ['v1']),
    ])
    expect(single.versions).toEqual([
      expect.objectContaining({ agentVersion: 'v1', runCount: 2, previousVersion: null, passScoreDelta: null, sameDataset: null }),
    ])
  })

  it('keys datasets by manifest hash, then by pin label', () => {
    expect(datasetKeyOf({ manifestHash: 'sha256:x', evalSetVersion: 'label' })).toBe('sha256:x')
    expect(datasetKeyOf({ manifestHash: null, evalSetVersion: 'label' })).toBe('label')
    expect(datasetKeyOf({ manifestHash: null, evalSetVersion: null })).toBeNull()
  })
})
