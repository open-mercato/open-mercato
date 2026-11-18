import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentEvalAssertion,
  AgentEvalCase,
  AgentEvalCaseRun,
  AgentEvalResult,
  AgentEvalSuiteRun,
  AgentRun,
} from '../data/entities'
import { runLlmJudgeForRun, type JudgeFn } from '../lib/eval/llmJudge'
import { aggregateSuiteRun, compareToBaseline, executeCaseRun } from '../lib/eval/evalReplayService'

const mockModelJudge = jest.fn<ReturnType<JudgeFn>, Parameters<JudgeFn>>()

jest.mock('../lib/eval/llmJudge', () => {
  const actual = jest.requireActual('../lib/eval/llmJudge')
  return { ...actual, createModelJudge: () => mockModelJudge }
})

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn(async () => undefined) }))

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const ASSERTION_IDS: Record<string, string> = {
  faithfulness: '00000000-0000-4000-8000-000000000001',
  tone: '00000000-0000-4000-8000-000000000002',
}

type Row = Record<string, unknown>

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function createFakeEm(seed: Map<unknown, Row[]>) {
  const stores = new Map<unknown, Row[]>()
  for (const [entity, rows] of seed) stores.set(entity, rows.map((row) => ({ ...row })))
  const pending: Row[] = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity) as Row[]
  }
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  const em = {
    create: (entity: unknown, data: Row) => ({ ...data, __entity: entity }),
    persist(row: Row) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const store = storeFor(row.__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Row) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
    async refresh() {
      return undefined
    },
    fork: () => em,
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function judgeAssertion(key: string) {
  return {
    id: ASSERTION_IDS[key],
    ...SCOPE,
    key,
    title: key,
    scorerKey: 'llm_judge',
    appliesTo: '*',
    type: 'llm_judge',
    enabled: true,
    deletedAt: null,
    severity: 'warn',
    config: { rubric: `judge ${key}` },
  }
}

function agentRun(id: string) {
  return { id, ...SCOPE, agentId: 'agent-a', status: 'completed', output: { answer: id }, evalPassed: true }
}

function caseRun(id: string, suiteRunId: string, status = 'passed') {
  return { id, suiteRunId, ...SCOPE, status, score: 1 }
}

const linkedJudge = (verdicts: Record<string, boolean>): JudgeFn => async ({ rubric }) => {
  const key = rubric.promptTemplate.replace('judge ', '')
  return { passed: verdicts[key] ?? true, score: verdicts[key] === false ? 0 : 1, feedback: key }
}

describe('replayed judge linkage', () => {
  beforeEach(() => {
    mockModelJudge.mockReset()
  })

  it('links judge results to the case run so the suite summary has a judge bucket', async () => {
    const { em, storeFor } = createFakeEm(
      new Map<unknown, Row[]>([
        [AgentRun, [agentRun('run-1')]],
        [AgentEvalAssertion, [judgeAssertion('faithfulness')]],
        [AgentEvalCaseRun, [caseRun('cr-1', 'suite-1')]],
      ]),
    )

    await runLlmJudgeForRun(em, SCOPE, 'run-1', linkedJudge({}), undefined, { evalCaseRunId: 'cr-1' })

    expect(storeFor(AgentEvalResult)[0].evalCaseRunId).toBe('cr-1')
    const aggregate = await aggregateSuiteRun(em, 'suite-1', SCOPE)
    expect(aggregate.summary.faithfulness).toEqual(
      expect.objectContaining({ judge: true, passed: 1, failed: 0, passRate: 1, severity: 'warn' }),
    )
  })

  it('fills judge deltas against a baseline suite run', async () => {
    const { em } = createFakeEm(
      new Map<unknown, Row[]>([
        [AgentRun, [agentRun('run-base'), agentRun('run-current')]],
        [AgentEvalAssertion, [judgeAssertion('faithfulness')]],
        [AgentEvalCaseRun, [caseRun('cr-base', 'suite-base'), caseRun('cr-current', 'suite-current')]],
      ]),
    )

    await runLlmJudgeForRun(em, SCOPE, 'run-base', linkedJudge({ faithfulness: true }), undefined, {
      evalCaseRunId: 'cr-base',
    })
    await runLlmJudgeForRun(em, SCOPE, 'run-current', linkedJudge({ faithfulness: false }), undefined, {
      evalCaseRunId: 'cr-current',
    })

    const baseline = await aggregateSuiteRun(em, 'suite-base', SCOPE)
    const current = await aggregateSuiteRun(em, 'suite-current', SCOPE)
    const comparison = compareToBaseline(current.summary, baseline.summary, 'suite-base')

    expect(comparison.judgeDeltas).toEqual({ faithfulness: -1 })
    expect(comparison.safetyRegressions).toEqual([])
  })

  it('passes the case expected value to the judge', async () => {
    const { em } = createFakeEm(
      new Map<unknown, Row[]>([
        [AgentRun, [agentRun('run-1')]],
        [AgentEvalAssertion, [judgeAssertion('faithfulness')]],
      ]),
    )
    const judge = jest.fn<ReturnType<JudgeFn>, Parameters<JudgeFn>>(async () => ({ passed: true, score: 1, feedback: '' }))

    await runLlmJudgeForRun(em, SCOPE, 'run-1', judge, undefined, {
      evalCaseRunId: 'cr-1',
      expected: { answer: 'golden' },
    })

    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({ runOutput: { answer: 'run-1' }, expected: { answer: 'golden' } }),
    )
  })

  it('applies only the judge assertions the case keeps enabled', async () => {
    const { em, storeFor } = createFakeEm(
      new Map<unknown, Row[]>([
        [AgentRun, [agentRun('run-1')]],
        [AgentEvalAssertion, [judgeAssertion('faithfulness'), judgeAssertion('tone')]],
      ]),
    )
    const judge = jest.fn<ReturnType<JudgeFn>, Parameters<JudgeFn>>(linkedJudge({}))

    const outcome = await runLlmJudgeForRun(em, SCOPE, 'run-1', judge, undefined, {
      evalCaseRunId: 'cr-1',
      assertions: [{ assertionId: ASSERTION_IDS.tone, disabled: true }],
    })

    expect(outcome).toEqual({ judged: 1, skipped: 0 })
    expect(judge).toHaveBeenCalledTimes(1)
    expect(storeFor(AgentEvalResult).map((row) => row.assertionKey)).toEqual(['faithfulness'])
  })

  it('leaves the online-plane call unchanged when no linkage is given', async () => {
    const { em, storeFor } = createFakeEm(
      new Map<unknown, Row[]>([
        [AgentRun, [agentRun('run-1')]],
        [AgentEvalAssertion, [judgeAssertion('faithfulness'), judgeAssertion('tone')]],
      ]),
    )
    const judge = jest.fn<ReturnType<JudgeFn>, Parameters<JudgeFn>>(linkedJudge({}))

    const outcome = await runLlmJudgeForRun(em, SCOPE, 'run-1', judge)

    expect(outcome).toEqual({ judged: 2, skipped: 0 })
    for (const [args] of judge.mock.calls) expect(Object.keys(args).sort()).toEqual(['rubric', 'runOutput'])
    for (const row of storeFor(AgentEvalResult)) expect(row).not.toHaveProperty('evalCaseRunId')
  })

  it('replays a case and links its judge results with the case expected value', async () => {
    const { em, storeFor } = createFakeEm(
      new Map<unknown, Row[]>([
        [AgentRun, [agentRun('run-1')]],
        [AgentEvalAssertion, [judgeAssertion('faithfulness'), judgeAssertion('tone')]],
        [AgentEvalSuiteRun, [{ id: 'suite-1', ...SCOPE, judgeMayGate: false }]],
        [AgentEvalCaseRun, [{ ...caseRun('cr-1', 'suite-1', 'pending'), evalCaseId: 'case-1', trialIndex: 0 }]],
        [
          AgentEvalCase,
          [
            {
              id: 'case-1',
              ...SCOPE,
              deletedAt: null,
              agentDefinitionId: 'agent-a',
              input: { question: 'q' },
              expected: { answer: 'golden' },
              assertions: [{ assertionId: ASSERTION_IDS.tone, disabled: true }],
            },
          ],
        ],
      ]),
    )
    mockModelJudge.mockImplementation(async () => ({ passed: false, score: 0, feedback: 'off' }))
    const runtime = {
      run: jest.fn(async (_agentId: string, _input: unknown, ctx: { onRunPersisted?: (runId: string) => void }) => {
        ctx.onRunPersisted?.('run-1')
        return {}
      }),
    }
    const container = {
      resolve: (name: string) => (name === 'em' ? em : runtime),
    } as unknown as AwilixContainer

    await executeCaseRun(container, 'cr-1', SCOPE, 'user-1')

    expect(mockModelJudge).toHaveBeenCalledTimes(1)
    expect(mockModelJudge).toHaveBeenCalledWith(expect.objectContaining({ expected: { answer: 'golden' } }))
    const judged = storeFor(AgentEvalResult)
    expect(judged).toHaveLength(1)
    expect(judged[0]).toEqual(expect.objectContaining({ evalCaseRunId: 'cr-1', assertionKey: 'faithfulness', severity: 'warn' }))

    const aggregate = await aggregateSuiteRun(em, 'suite-1', SCOPE)
    expect(aggregate.summary.faithfulness).toEqual(expect.objectContaining({ judge: true, failed: 1 }))
  })
})
