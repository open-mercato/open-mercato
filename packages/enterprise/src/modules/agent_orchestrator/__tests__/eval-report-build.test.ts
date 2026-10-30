import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentEvalAssertion,
  AgentEvalCase,
  AgentEvalCaseRun,
  AgentEvalResult,
  AgentEvalSuiteRun,
  AgentRun,
} from '../data/entities'
import { buildEvalReport, EvalRunNotFinishedError, percentile } from '../lib/eval/report/buildEvalReport'
import { evalReportSchema } from '../lib/eval/report/reportSchema'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const OTHER_SCOPE = { tenantId: 'tenant-2', organizationId: 'org-2' }
const FIXED_NOW = () => new Date('2026-10-22T12:00:00.000Z')

type Row = Record<string, unknown>

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('$in' in (expected as object)) return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
    if ('$ne' in (expected as object)) return actual !== (expected as { $ne: unknown }).$ne
    if ('$lt' in (expected as object)) {
      return actual instanceof Date && actual < ((expected as { $lt: Date }).$lt)
    }
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function createFakeEm(seed: Map<unknown, Row[]>) {
  const queried: Array<{ entity: unknown; where: Row }> = []
  const storeFor = (entity: unknown) => seed.get(entity) ?? []
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  const em = {
    async findOne(entity: unknown, where: Row) {
      queried.push({ entity, where })
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row, options?: { limit?: number }) {
      queried.push({ entity, where })
      const rows = storeFor(entity).filter((row) => matches(row, where))
      return options?.limit ? rows.slice(0, options.limit) : rows
    },
    fork: () => em,
  }
  return { em: em as unknown as EntityManager, queried }
}

function suiteRun(id: string, overrides: Row = {}): Row {
  return {
    id,
    ...SCOPE,
    agentDefinitionId: 'agent-a',
    releaseId: null,
    trigger: 'ci',
    status: 'completed',
    outcome: 'passed',
    judgeMayGate: false,
    repeatCount: 1,
    caseCount: 2,
    errorCount: 0,
    evalSetVersion: 'release-1',
    passScore: 1,
    scoreVariance: null,
    baselineSuiteRunId: null,
    summary: null,
    startedAt: new Date('2026-10-22T10:00:00.000Z'),
    finishedAt: new Date('2026-10-22T10:05:00.000Z'),
    createdAt: new Date('2026-10-22T10:00:00.000Z'),
    ...overrides,
  }
}

function caseRun(id: string, suiteRunId: string, evalCaseId: string, overrides: Row = {}): Row {
  return {
    id,
    ...SCOPE,
    suiteRunId,
    evalCaseId,
    agentRunId: `run-${id}`,
    trialIndex: 0,
    status: 'passed',
    score: 1,
    passed: true,
    latencyMs: 100,
    costMinor: 10,
    errorMessage: null,
    createdAt: new Date('2026-10-22T10:01:00.000Z'),
    ...overrides,
  }
}

function result(caseRunId: string, assertionId: string, assertionKey: string, passed: boolean | null, overrides: Row = {}): Row {
  return {
    id: `res-${caseRunId}-${assertionKey}`,
    ...SCOPE,
    agentRunId: `run-${caseRunId}`,
    evalCaseRunId: caseRunId,
    assertionId,
    assertionKey,
    passed,
    score: passed === null ? null : passed ? 1 : 0,
    severity: 'gate',
    evidence: passed === null ? { reason: 'not_applicable' } : { matched: passed },
    ...overrides,
  }
}

function agentRun(id: string, overrides: Row = {}): Row {
  return {
    id,
    ...SCOPE,
    agentId: 'agent-a',
    model: 'model-x',
    currency: 'USD',
    inputTokens: 100,
    outputTokens: 20,
    output: { answer: `secret output of ${id}` },
    ...overrides,
  }
}

const ASSERTIONS: Row[] = [
  { id: 'a-exact', ...SCOPE, key: 'exact', scorerKey: 'exact_match', type: 'deterministic', severity: 'gate' },
  { id: 'a-judge', ...SCOPE, key: 'faithfulness', scorerKey: 'llm_judge', type: 'llm_judge', severity: 'warn' },
]

const CASES: Row[] = [
  { id: 'case-1', ...SCOPE, name: 'First case', input: { prompt: 'secret input 1' }, expected: { answer: 'one' } },
  { id: 'case-2', ...SCOPE, name: null, input: { prompt: 'secret input 2' }, expected: null },
]

function baseSeed(): Map<unknown, Row[]> {
  return new Map<unknown, Row[]>([
    [AgentEvalSuiteRun, [suiteRun('suite-1')]],
    [
      AgentEvalCaseRun,
      [
        caseRun('cr-1', 'suite-1', 'case-1', { latencyMs: 100, costMinor: 10 }),
        caseRun('cr-2', 'suite-1', 'case-2', { status: 'failed', passed: false, score: 0, latencyMs: 300, costMinor: 30 }),
        caseRun('cr-x', 'suite-1', 'case-foreign', { ...OTHER_SCOPE }),
      ],
    ],
    [
      AgentEvalResult,
      [
        result('cr-1', 'a-exact', 'exact', true),
        result('cr-1', 'a-judge', 'faithfulness', true, { severity: 'warn', evidence: { feedback: 'well grounded' } }),
        result('cr-2', 'a-exact', 'exact', false),
        result('cr-2', 'a-judge', 'faithfulness', null, { severity: 'warn', evidence: { reason: 'invalid_config' } }),
        result('cr-x', 'a-exact', 'exact', false, { ...OTHER_SCOPE }),
      ],
    ],
    [AgentEvalAssertion, ASSERTIONS],
    [AgentEvalCase, [...CASES, { id: 'case-foreign', ...OTHER_SCOPE, name: 'foreign', input: {} }]],
    [AgentRun, [agentRun('run-cr-1'), agentRun('run-cr-2', { model: 'model-y' }), agentRun('run-cr-x', { ...OTHER_SCOPE })]],
  ])
}

describe('buildEvalReport', () => {
  it('produces a report that validates against the versioned schema', async () => {
    const { em } = createFakeEm(baseSeed())
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { now: FIXED_NOW, env: {} })

    expect(report).not.toBeNull()
    expect(() => evalReportSchema.parse(report)).not.toThrow()
    expect(report?.schema).toBe('open-mercato.agent-eval-report')
    expect(report?.schemaVersion).toBe(1)
    expect(report?.generatedAt).toBe('2026-10-22T12:00:00.000Z')
    expect(report?.status).toBe('completed')
    expect(report?.suiteRun).toMatchObject({ id: 'suite-1', agentId: 'agent-a', trigger: 'ci', outcome: 'passed' })
    expect(report?.evalSet).toEqual({
      version: 'release-1',
      pinKind: 'label',
      manifestHash: null,
      label: 'release-1',
      source: 'db',
      caseCount: 2,
      assertionCount: 2,
    })
    expect(report?.environment).toEqual({
      models: ['model-x', 'model-y'],
      modelSettings: {},
      toolMode: 'live',
      modelMode: 'live',
      gitSha: null,
      cliVersion: null,
    })
    expect(report?.totals).toEqual({
      cases: 2,
      trials: 2,
      passed: 1,
      failed: 1,
      errored: 0,
      skipped: 0,
      flakyCases: 0,
      costMinor: 40,
      currency: 'USD',
      latencyMs: { p50: 100, p95: 300, max: 300 },
      tokens: { input: 200, output: 40 },
    })
  })

  it('reports per-trial assertion results with judge feedback and skip reasons', async () => {
    const { em } = createFakeEm(baseSeed())
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })
    const first = report?.cases.find((entry) => entry.id === 'case-1')
    const second = report?.cases.find((entry) => entry.id === 'case-2')

    expect(first?.name).toBe('First case')
    expect(first?.trials[0]).toMatchObject({ caseRunId: 'cr-1', agentRunId: 'run-cr-1', tracePath: '/backend/traces/run-cr-1' })
    expect(first?.trials[0].results.find((entry) => entry.assertionKey === 'faithfulness')).toMatchObject({
      scorerKey: 'llm_judge',
      type: 'llm_judge',
      judgeFeedback: 'well grounded',
      skipReason: null,
    })
    expect(second?.trials[0].results.find((entry) => entry.assertionKey === 'faithfulness')).toMatchObject({
      passed: null,
      skipReason: 'invalid_config',
    })
  })

  it('stays inside the caller tenant and organization', async () => {
    const { em, queried } = createFakeEm(baseSeed())
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })

    expect(report?.cases.map((entry) => entry.id)).toEqual(['case-1', 'case-2'])
    expect(report?.totals.trials).toBe(2)
    expect(JSON.stringify(report)).not.toContain('cr-x')
    for (const query of queried) {
      expect(query.where).toMatchObject(SCOPE)
    }
    expect(await buildEvalReport(em, OTHER_SCOPE, 'suite-1', { env: {} })).toBeNull()
  })

  it('excludes case inputs and agent outputs by default', async () => {
    const { em } = createFakeEm(baseSeed())
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })
    const serialized = JSON.stringify(report)

    expect(serialized).not.toContain('secret input')
    expect(serialized).not.toContain('secret output')
    for (const reportCase of report?.cases ?? []) {
      expect('input' in reportCase).toBe(false)
      expect('expected' in reportCase).toBe(false)
      for (const trial of reportCase.trials) expect('output' in trial).toBe(false)
    }
  })

  it('includes payloads only on explicit opt-in', async () => {
    const { em } = createFakeEm(baseSeed())
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { includePayloads: true, env: {} })
    const first = report?.cases.find((entry) => entry.id === 'case-1')

    expect(() => evalReportSchema.parse(report)).not.toThrow()
    expect(first?.input).toEqual({ prompt: 'secret input 1' })
    expect(first?.expected).toEqual({ answer: 'one' })
    expect(first?.trials[0].output).toEqual({ answer: 'secret output of run-cr-1' })
  })

  it('truncates evidence to the configured excerpt length', async () => {
    const seed = baseSeed()
    const results = seed.get(AgentEvalResult) as Row[]
    results[0] = { ...results[0], evidence: { detail: 'x'.repeat(500) } }
    const { em } = createFakeEm(seed)
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { evidenceMaxChars: 120, env: {} })
    const evidence = report?.cases[0].trials[0].results.find((entry) => entry.assertionKey === 'exact')?.evidence

    expect(evidence).toMatchObject({ truncated: true })
    expect(JSON.stringify(evidence).length).toBeLessThan(200)
  })

  it('compares against the stored baseline including judge deltas', async () => {
    const seed = baseSeed()
    ;(seed.get(AgentEvalSuiteRun) as Row[]).push(
      suiteRun('suite-0', { createdAt: new Date('2026-10-21T10:00:00.000Z') }),
    )
    ;(seed.get(AgentEvalSuiteRun) as Row[])[0].baselineSuiteRunId = 'suite-0'
    ;(seed.get(AgentEvalCaseRun) as Row[]).push(
      caseRun('cb-1', 'suite-0', 'case-1'),
      caseRun('cb-2', 'suite-0', 'case-2'),
    )
    ;(seed.get(AgentEvalResult) as Row[]).push(
      result('cb-1', 'a-exact', 'exact', true),
      result('cb-2', 'a-exact', 'exact', true),
      result('cb-1', 'a-judge', 'faithfulness', false, { severity: 'warn' }),
      result('cb-2', 'a-judge', 'faithfulness', false, { severity: 'warn' }),
    )
    const { em } = createFakeEm(seed)
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })

    expect(report?.baseline).toEqual({ suiteRunId: 'suite-0', manifestHash: null, sameDataset: null, warnings: [] })
    expect(report?.regressions).toEqual(['exact'])
    expect(report?.assertions.find((entry) => entry.key === 'exact')).toMatchObject({
      passRate: 0.5,
      baselinePassRate: 1,
      delta: -0.5,
      regressed: true,
    })
    expect(report?.assertions.find((entry) => entry.key === 'faithfulness')).toMatchObject({
      type: 'llm_judge',
      passRate: 1,
      baselinePassRate: 0,
      delta: 1,
      regressed: false,
    })
    expect(report?.cases.map((entry) => entry.baselineStatus)).toEqual(['passed', 'passed'])
  })

  it('marks every case absent and leaves deltas null without a baseline', async () => {
    const { em } = createFakeEm(baseSeed())
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })

    expect(report?.baseline.suiteRunId).toBeNull()
    expect(report?.regressions).toEqual([])
    expect(report?.cases.every((entry) => entry.baselineStatus === 'absent')).toBe(true)
    expect(report?.assertions.every((entry) => entry.delta === null && entry.baselinePassRate === null)).toBe(true)
  })

  it('refuses an unfinished run unless a partial report is requested', async () => {
    const seed = baseSeed()
    const suite = (seed.get(AgentEvalSuiteRun) as Row[])[0]
    suite.status = 'running'
    suite.outcome = null
    suite.finishedAt = null
    ;(seed.get(AgentEvalCaseRun) as Row[])[1].status = 'pending'
    const { em } = createFakeEm(seed)

    await expect(buildEvalReport(em, SCOPE, 'suite-1', { env: {} })).rejects.toBeInstanceOf(EvalRunNotFinishedError)

    const report = await buildEvalReport(em, SCOPE, 'suite-1', { partial: true, env: {} })
    expect(() => evalReportSchema.parse(report)).not.toThrow()
    expect(report?.status).toBe('running')
    expect(report?.suiteRun.finishedAt).toBeNull()
    expect(report?.totals).toMatchObject({ trials: 2, passed: 1, failed: 0 })
  })

  it('derives the pin kind from the stored eval set version', async () => {
    const hashVersion = `sha256:${'a'.repeat(64)}`
    for (const [version, pinKind, label] of [
      [hashVersion, 'hash', null],
      [null, 'none', null],
    ] as const) {
      const seed = baseSeed()
      ;(seed.get(AgentEvalSuiteRun) as Row[])[0].evalSetVersion = version
      const { em } = createFakeEm(seed)
      const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })
      expect(report?.evalSet).toMatchObject({ version, pinKind, label, manifestHash: null })
    }
  })

  it('flags flaky cases and assertions across repeated trials', async () => {
    const seed = baseSeed()
    ;(seed.get(AgentEvalSuiteRun) as Row[])[0].repeatCount = 2
    ;(seed.get(AgentEvalCaseRun) as Row[]).push(caseRun('cr-1b', 'suite-1', 'case-1', { trialIndex: 1, status: 'failed' }))
    ;(seed.get(AgentEvalResult) as Row[]).push(result('cr-1b', 'a-exact', 'exact', false))
    ;(seed.get(AgentRun) as Row[]).push(agentRun('run-cr-1b'))
    const { em } = createFakeEm(seed)
    const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })

    expect(report?.totals.flakyCases).toBe(1)
    expect(report?.cases.find((entry) => entry.id === 'case-1')?.flaky).toBe(true)
    expect(report?.cases.find((entry) => entry.id === 'case-1')?.trials.map((entry) => entry.trialIndex)).toEqual([0, 1])
    expect(report?.assertions.find((entry) => entry.key === 'exact')?.flaky).toBe(true)
    expect(report?.assertions.find((entry) => entry.key === 'faithfulness')?.flaky).toBe(false)
  })

  it('stamps the environment from CI variables and the caller', async () => {
    const { em } = createFakeEm(baseSeed())
    const report = await buildEvalReport(em, SCOPE, 'suite-1', {
      cliVersion: '1.2.3',
      env: { OM_EVAL_GIT_SHA: 'abc123', OM_AI_PROVIDER: 'scripted' },
    })
    expect(report?.environment).toMatchObject({ gitSha: 'abc123', cliVersion: '1.2.3', modelMode: 'scripted' })
  })

  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20)
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40)
  })
})
