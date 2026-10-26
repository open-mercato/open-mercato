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
import type { JudgeFn } from '../lib/eval/llmJudge'
import { aggregateSuiteRun, executeCaseRun, resetEvalSetManifestCache } from '../lib/eval/evalReplayService'
import {
  EVAL_SET_SUMMARY_KEY,
  buildEvalSetPointer,
  findEvalSetCarrier,
  freezeManifest,
} from '../lib/eval/manifest'

const mockModelJudge = jest.fn<ReturnType<JudgeFn>, Parameters<JudgeFn>>()

jest.mock('../lib/eval/llmJudge', () => {
  const actual = jest.requireActual('../lib/eval/llmJudge')
  return { ...actual, createModelJudge: () => mockModelJudge }
})

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn(async () => undefined) }))

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const AGENT = 'content_review.validator'
const CASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REGEX_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const JUDGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CARRIER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const FOLLOWER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

type Row = Record<string, unknown>

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function createFakeEm(seed: Map<unknown, Row[]>) {
  const stores = new Map<unknown, Row[]>(seed)
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

function liveSeed(): Map<unknown, Row[]> {
  return new Map<unknown, Row[]>([
    [
      AgentEvalCase,
      [
        {
          id: CASE_ID,
          ...SCOPE,
          agentDefinitionId: AGENT,
          name: 'pinned case',
          input: { question: 'frozen question' },
          expected: { answer: 'frozen expected' },
          assertions: null,
          status: 'approved',
          deletedAt: null,
        },
      ],
    ],
    [
      AgentEvalAssertion,
      [
        {
          id: REGEX_ID,
          ...SCOPE,
          key: 'mentions_golden',
          scorerKey: 'regex',
          title: 'Mentions golden',
          description: null,
          appliesTo: AGENT,
          type: 'deterministic',
          severity: 'gate',
          config: { pattern: 'golden' },
          enabled: true,
          deletedAt: null,
        },
        {
          id: JUDGE_ID,
          ...SCOPE,
          key: 'tone',
          scorerKey: 'llm_judge',
          title: 'Tone',
          description: null,
          appliesTo: '*',
          type: 'llm_judge',
          severity: 'warn',
          config: { rubric: 'frozen rubric' },
          enabled: true,
          deletedAt: null,
        },
      ],
    ],
    [AgentRun, [{ id: 'run-1', ...SCOPE, agentId: AGENT, status: 'completed', output: { answer: 'a golden answer' } }]],
  ])
}

function editLiveRows(storeFor: (entity: unknown) => Row[]): void {
  const liveCase = storeFor(AgentEvalCase)[0]
  liveCase.input = { question: 'edited question' }
  liveCase.expected = { answer: 'edited expected' }
  const regex = storeFor(AgentEvalAssertion).find((row) => row.id === REGEX_ID) as Row
  regex.config = { pattern: 'never-present' }
  const judge = storeFor(AgentEvalAssertion).find((row) => row.id === JUDGE_ID) as Row
  judge.config = { rubric: 'edited rubric' }
}

function suiteRun(id: string, summary: Row | null, status = 'running'): Row {
  return {
    id,
    ...SCOPE,
    agentDefinitionId: AGENT,
    status,
    judgeMayGate: false,
    summary,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  }
}

function pendingCaseRun(id: string, suiteRunId: string): Row {
  return { id, suiteRunId, ...SCOPE, evalCaseId: CASE_ID, status: 'pending', trialIndex: 0 }
}

function harness(em: EntityManager) {
  const runtime = {
    run: jest.fn(async (_agentId: string, _input: unknown, ctx: { onRunPersisted?: (runId: string) => void }) => {
      ctx.onRunPersisted?.('run-1')
      return {}
    }),
  }
  const container = {
    resolve: (name: string) => (name === 'em' ? em : runtime),
  } as unknown as AwilixContainer
  return { runtime, container }
}

describe('replay from the frozen eval-set manifest', () => {
  beforeEach(() => {
    resetEvalSetManifestCache()
    mockModelJudge.mockReset()
    mockModelJudge.mockImplementation(async () => ({ passed: true, score: 1, feedback: '' }))
  })

  it('replays the frozen input, expected value and assertion configs after the live rows were edited', async () => {
    const seed = liveSeed()
    const { em, storeFor } = createFakeEm(seed)
    const { manifest, version } = await freezeManifest(em, SCOPE, { agentId: AGENT })
    const pointer = buildEvalSetPointer({ manifest, version, suiteRunId: CARRIER_ID, carrierSuiteRunId: null })
    storeFor(AgentEvalSuiteRun).push(suiteRun(CARRIER_ID, { [EVAL_SET_SUMMARY_KEY]: pointer }))
    storeFor(AgentEvalCaseRun).push(pendingCaseRun('cr-1', CARRIER_ID))
    editLiveRows(storeFor)
    const { runtime, container } = harness(em)

    const outcome = await executeCaseRun(container, 'cr-1', SCOPE, 'user-1')

    expect(runtime.run).toHaveBeenCalledWith(AGENT, { question: 'frozen question' }, expect.anything())
    expect(outcome.status).toBe('passed')
    expect(mockModelJudge).toHaveBeenCalledTimes(1)
    const [judgeArgs] = mockModelJudge.mock.calls[0]
    expect(judgeArgs.rubric.promptTemplate).toBe('frozen rubric')
    expect(judgeArgs.expected).toEqual({ answer: 'frozen expected' })

    const results = storeFor(AgentEvalResult)
    expect(results.map((row) => row.assertionKey).sort((left, right) => String(left).localeCompare(String(right)))).toEqual([
      'mentions_golden',
      'tone',
    ])
    expect(results.find((row) => row.assertionKey === 'mentions_golden')?.passed).toBe(true)

    storeFor(AgentEvalAssertion).splice(0)
    const aggregate = await aggregateSuiteRun(em, CARRIER_ID, SCOPE)
    expect(aggregate.summary.tone).toEqual(expect.objectContaining({ judge: true, passed: 1 }))
    expect(aggregate.summary.mentions_golden).toEqual(expect.objectContaining({ judge: false, passed: 1 }))
  })

  it('uses the live rows for a suite run without a frozen eval set', async () => {
    const { em, storeFor } = createFakeEm(liveSeed())
    storeFor(AgentEvalSuiteRun).push(suiteRun(CARRIER_ID, null))
    storeFor(AgentEvalCaseRun).push(pendingCaseRun('cr-1', CARRIER_ID))
    editLiveRows(storeFor)
    const { runtime, container } = harness(em)

    const outcome = await executeCaseRun(container, 'cr-1', SCOPE, 'user-1')

    expect(runtime.run).toHaveBeenCalledWith(AGENT, { question: 'edited question' }, expect.anything())
    expect(outcome.status).toBe('failed')
    const [judgeArgs] = mockModelJudge.mock.calls[0]
    expect(judgeArgs.rubric.promptTemplate).toBe('edited rubric')
    expect(judgeArgs.expected).toEqual({ answer: 'edited expected' })
  })

  it('errors the case with eval_set_unresolved when the pointer cannot be resolved', async () => {
    const { em, storeFor } = createFakeEm(liveSeed())
    const dangling = {
      version: 'sha256:missing',
      label: null,
      source: 'db',
      caseCount: 1,
      assertionCount: 2,
      carrierSuiteRunId: CARRIER_ID,
    }
    storeFor(AgentEvalSuiteRun).push(suiteRun(FOLLOWER_ID, { [EVAL_SET_SUMMARY_KEY]: dangling }))
    storeFor(AgentEvalCaseRun).push(pendingCaseRun('cr-1', FOLLOWER_ID))
    const { runtime, container } = harness(em)

    const outcome = await executeCaseRun(container, 'cr-1', SCOPE, 'user-1')

    expect(outcome.status).toBe('error')
    expect(runtime.run).not.toHaveBeenCalled()
    expect(storeFor(AgentEvalCaseRun)[0].errorMessage).toContain('eval_set_unresolved')
    expect(storeFor(AgentEvalResult)).toHaveLength(0)
  })

  it('resolves the body from a carrier that ended failed', async () => {
    const { em, storeFor } = createFakeEm(liveSeed())
    const { manifest, version } = await freezeManifest(em, SCOPE, { agentId: AGENT })
    const carrierPointer = buildEvalSetPointer({ manifest, version, suiteRunId: CARRIER_ID, carrierSuiteRunId: null })
    const followerPointer = buildEvalSetPointer({ manifest, version, suiteRunId: FOLLOWER_ID, carrierSuiteRunId: CARRIER_ID })
    storeFor(AgentEvalSuiteRun).push(
      suiteRun(CARRIER_ID, { [EVAL_SET_SUMMARY_KEY]: carrierPointer }, 'failed'),
      suiteRun(FOLLOWER_ID, { [EVAL_SET_SUMMARY_KEY]: followerPointer }),
    )
    storeFor(AgentEvalCaseRun).push(pendingCaseRun('cr-1', FOLLOWER_ID))
    editLiveRows(storeFor)
    const { runtime, container } = harness(em)

    expect(await findEvalSetCarrier(em, SCOPE, AGENT, version)).toBe(CARRIER_ID)
    const outcome = await executeCaseRun(container, 'cr-1', SCOPE, 'user-1')

    expect(runtime.run).toHaveBeenCalledWith(AGENT, { question: 'frozen question' }, expect.anything())
    expect(outcome.status).toBe('passed')
  })
})
