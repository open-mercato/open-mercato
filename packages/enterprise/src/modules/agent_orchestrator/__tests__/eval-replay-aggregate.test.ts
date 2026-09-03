import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentEvalCaseRun, AgentEvalResult } from '../data/entities'
import { aggregateSuiteRun } from '../lib/eval/evalReplayService'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const SUITE = 'suite-1'

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  return actual === expected
}

function createFakeEm(seed: {
  caseRuns?: Array<Record<string, unknown>>
  results?: Array<Record<string, unknown>>
}) {
  const stores = new Map<unknown, Array<Record<string, unknown>>>([
    [AgentEvalCaseRun, (seed.caseRuns ?? []).map((row) => ({ ...row }))],
    [AgentEvalResult, (seed.results ?? []).map((row) => ({ ...row }))],
  ])
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  return {
    async find(entity: unknown, where: Record<string, unknown>) {
      return (stores.get(entity) ?? []).filter((row) => matches(row, where))
    },
  } as unknown as EntityManager
}

function caseRun(id: string, status: string, score: number | null = null) {
  return { id, suiteRunId: SUITE, ...SCOPE, status, score }
}

function result(caseRunId: string, assertionKey: string, passed: boolean | null, severity = 'gate') {
  return { id: `r-${caseRunId}-${assertionKey}`, evalCaseRunId: caseRunId, ...SCOPE, assertionKey, passed, severity }
}

describe('aggregateSuiteRun', () => {
  it('excludes errored case runs from passScore and counts them separately', async () => {
    // An errored case is not a passing case, and averaging it as zero would
    // misrepresent both the score and the failure count.
    const em = createFakeEm({
      caseRuns: [
        caseRun('c1', 'passed', 1),
        caseRun('c2', 'failed', 0),
        caseRun('c3', 'error'),
        caseRun('c4', 'error'),
      ],
    })
    const aggregate = await aggregateSuiteRun(em, SUITE, SCOPE)

    expect(aggregate.caseCount).toBe(4)
    expect(aggregate.errorCount).toBe(2)
    expect(aggregate.passScore).toBe(0.5)
  })

  it('excludes skipped case runs from passScore', async () => {
    const em = createFakeEm({
      caseRuns: [caseRun('c1', 'passed', 1), caseRun('c2', 'skipped'), caseRun('c3', 'skipped')],
    })
    const aggregate = await aggregateSuiteRun(em, SUITE, SCOPE)
    expect(aggregate.passScore).toBe(1)
    expect(aggregate.errorCount).toBe(0)
  })

  it('returns a null passScore when nothing was measurable', async () => {
    const em = createFakeEm({ caseRuns: [caseRun('c1', 'error'), caseRun('c2', 'error')] })
    const aggregate = await aggregateSuiteRun(em, SUITE, SCOPE)
    // Phase 5 turns this into outcome 'failed': an unmeasurable gate is a failed
    // gate, never a pass.
    expect(aggregate.passScore).toBeNull()
    expect(aggregate.errorCount).toBe(2)
  })

  it('reports variance only when there is more than one measured score', async () => {
    const single = await aggregateSuiteRun(createFakeEm({ caseRuns: [caseRun('c1', 'passed', 1)] }), SUITE, SCOPE)
    expect(single.scoreVariance).toBeNull()

    const many = await aggregateSuiteRun(
      createFakeEm({ caseRuns: [caseRun('c1', 'passed', 1), caseRun('c2', 'failed', 0)] }),
      SUITE,
      SCOPE,
    )
    expect(many.scoreVariance).toBeCloseTo(0.25)
  })

  it('buckets per-assertion outcomes with skipped kept apart from failed', async () => {
    const em = createFakeEm({
      caseRuns: [caseRun('c1', 'passed', 1), caseRun('c2', 'failed', 0)],
      results: [
        result('c1', 'no_pii', true),
        result('c2', 'no_pii', false),
        result('c1', 'json_match', null),
        result('c2', 'json_match', null),
      ],
    })
    const aggregate = await aggregateSuiteRun(em, SUITE, SCOPE)

    expect(aggregate.summary.no_pii).toMatchObject({ passed: 1, failed: 1, skipped: 0 })
    // Two skipped assertions must not read as two failures.
    expect(aggregate.summary.json_match).toMatchObject({ passed: 0, failed: 0, skipped: 2 })
  })

  it('scopes every read by tenant and organization', async () => {
    const em = createFakeEm({
      caseRuns: [caseRun('c1', 'passed', 1), { ...caseRun('c2', 'failed', 0), organizationId: 'other-org' }],
    })
    const aggregate = await aggregateSuiteRun(em, SUITE, SCOPE)
    expect(aggregate.caseCount).toBe(1)
    expect(aggregate.passScore).toBe(1)
  })
})

describe('baseline comparison', () => {
  const bucket = (overrides: Partial<import('../lib/eval/evalReplayService').AssertionBucket>) => ({
    passed: 0,
    failed: 0,
    skipped: 0,
    severity: 'gate',
    judge: false,
    passRate: null,
    ...overrides,
  })

  it('flags a gate assertion whose pass rate dropped', async () => {
    const { compareToBaseline } = await import('../lib/eval/evalReplayService')
    const result = compareToBaseline(
      { no_pii: bucket({ passRate: 0.5 }) },
      { no_pii: bucket({ passRate: 1 }) },
      'base-1',
    )
    expect(result.safetyRegressions).toEqual(['no_pii'])
    expect(result.baselineSuiteRunId).toBe('base-1')
  })

  it('does not flag an improvement or a steady rate', async () => {
    const { compareToBaseline } = await import('../lib/eval/evalReplayService')
    expect(
      compareToBaseline({ a: bucket({ passRate: 1 }) }, { a: bucket({ passRate: 0.5 }) }, 'b').safetyRegressions,
    ).toEqual([])
    expect(
      compareToBaseline({ a: bucket({ passRate: 1 }) }, { a: bucket({ passRate: 1 }) }, 'b').safetyRegressions,
    ).toEqual([])
  })

  it('never turns a judge drop into a regression — only a reported delta', async () => {
    // Gating on a stochastic verdict is what makes CI flaky; the judge tier
    // reports movement and never blocks.
    const { compareToBaseline } = await import('../lib/eval/evalReplayService')
    const result = compareToBaseline(
      { helpfulness: bucket({ judge: true, severity: 'gate', passRate: 0.4 }) },
      { helpfulness: bucket({ judge: true, severity: 'gate', passRate: 0.9 }) },
      'base-1',
    )
    expect(result.safetyRegressions).toEqual([])
    expect(result.judgeDeltas.helpfulness).toBeCloseTo(-0.5)
  })

  it('ignores a warn-severity drop', async () => {
    const { compareToBaseline } = await import('../lib/eval/evalReplayService')
    const result = compareToBaseline(
      { soft: bucket({ severity: 'warn', passRate: 0 }) },
      { soft: bucket({ severity: 'warn', passRate: 1 }) },
      'base-1',
    )
    expect(result.safetyRegressions).toEqual([])
  })

  it('reports nothing when there is no baseline to compare against', async () => {
    const { compareToBaseline } = await import('../lib/eval/evalReplayService')
    const result = compareToBaseline({ a: bucket({ passRate: 0 }) }, null, null)
    expect(result).toEqual({ baselineSuiteRunId: null, safetyRegressions: [], judgeDeltas: {} })
  })

  it('skips assertions absent from the baseline rather than treating them as regressions', async () => {
    // A newly added assertion has nothing to regress from.
    const { compareToBaseline } = await import('../lib/eval/evalReplayService')
    expect(compareToBaseline({ fresh: bucket({ passRate: 0 }) }, {}, 'b').safetyRegressions).toEqual([])
  })
})
