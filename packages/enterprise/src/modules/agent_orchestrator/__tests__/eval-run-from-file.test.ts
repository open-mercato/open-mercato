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
import { startEvalRunCommand } from '../commands/evalRuns'
import * as replayModule from '../lib/eval/evalReplayService'
import { executeCaseRun, resetEvalSetManifestCache } from '../lib/eval/evalReplayService'
import { runEvalGate } from '../lib/eval/evalGate'
import { manifestFromFile, parseEvalSetFile, type EvalSetFile } from '../lib/eval/evalSetFile'
import { buildEvalReport } from '../lib/eval/report/buildEvalReport'
import {
  EVAL_SET_FORMAT,
  EVAL_SET_SUMMARY_KEY,
  deterministicAssertionId,
  deterministicCaseId,
  readEvalSetPointer,
} from '../lib/eval/manifest'
import { emitAgentOrchestratorEvent } from '../events'

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn(async () => undefined) }))

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const AGENT = 'content_review.validator'
const DB_CASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Row = Record<string, unknown>

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('$in' in (expected as object)) return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
    if ('$ne' in (expected as object)) return actual !== (expected as { $ne: unknown }).$ne
    if ('$lt' in (expected as object)) return actual instanceof Date && actual < (expected as { $lt: Date }).$lt
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function createFakeEm(seed: Array<[unknown, Row[]]> = []) {
  const stores = new Map<unknown, Row[]>(seed.map(([entity, rows]) => [entity, rows.map((row) => ({ ...row }))]))
  const pending: Row[] = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity) as Row[]
  }
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  const queried: unknown[] = []
  const em = {
    fork: () => em,
    async begin() {},
    async commit() {
      await em.flush()
    },
    async rollback() {
      pending.splice(0)
    },
    create: (entity: unknown, data: Row) => ({ ...data, __entity: entity }),
    persist(row: Row) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        if (!row.createdAt) row.createdAt = new Date()
        const store = storeFor(row.__entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Row) {
      queried.push(entity)
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row, options?: { limit?: number }) {
      queried.push(entity)
      const rows = storeFor(entity).filter((row) => matches(row, where))
      return options?.limit ? rows.slice(0, options.limit) : rows
    },
    async refresh() {
      return undefined
    },
  }
  return { em: em as unknown as EntityManager, storeFor, queried }
}

function ctxFor(em: EntityManager) {
  return { container: { resolve: () => em } } as never
}

function sampleFile(): Record<string, unknown> {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId: AGENT,
    label: 'regression-set',
    assertions: [
      {
        key: 'mentions_golden',
        scorerKey: 'regex',
        severity: 'gate',
        title: 'Mentions golden',
        config: { pattern: 'golden' },
      },
    ],
    cases: [
      { key: 'case-b', input: { question: 'second' } },
      { key: 'case-a', name: 'First case', input: { question: 'first' }, expected: { answer: 'golden' } },
    ],
  }
}

describe('evalRuns.start with an eval-set file', () => {
  beforeEach(() => {
    jest.mocked(emitAgentOrchestratorEvent).mockClear()
  })

  it('freezes the file manifest, pins its hash and needs no eval case rows', async () => {
    const { em, storeFor, queried } = createFakeEm()

    const result = await startEvalRunCommand.execute(
      { ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile(), repeatCount: 2 },
      ctxFor(em),
    )

    const expected = manifestFromFile(parseEvalSetFile(sampleFile()))
    expect(result.caseRunCount).toBe(4)
    expect(queried).not.toContain(AgentEvalCase)
    const [suite] = storeFor(AgentEvalSuiteRun)
    expect(suite.evalSetVersion).toBe(expected.version)
    const pointer = readEvalSetPointer(suite.summary)
    expect(pointer).toEqual(
      expect.objectContaining({
        version: expected.version,
        source: 'file',
        label: 'regression-set',
        caseCount: 2,
        assertionCount: 1,
        carrierSuiteRunId: result.suiteRunId,
      }),
    )
    expect(pointer?.body).toEqual(expected.manifest)
    const caseIds = storeFor(AgentEvalCaseRun).map((row) => row.evalCaseId)
    expect(new Set(caseIds)).toEqual(
      new Set([deterministicCaseId(AGENT, 'case-a'), deterministicCaseId(AGENT, 'case-b')]),
    )
    expect(storeFor(AgentEvalCaseRun).every((row) => row.suiteRunId === result.suiteRunId)).toBe(true)
  })

  it('narrows the file cases with evalCaseIds', async () => {
    const { em, storeFor } = createFakeEm()
    const caseA = deterministicCaseId(AGENT, 'case-a')

    const result = await startEvalRunCommand.execute(
      { ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile(), evalCaseIds: [caseA] },
      ctxFor(em),
    )

    expect(result.caseRunCount).toBe(1)
    expect(storeFor(AgentEvalCaseRun).map((row) => row.evalCaseId)).toEqual([caseA])
  })

  it('reuses an earlier carrier of the same file hash instead of storing the body again', async () => {
    const { em, storeFor } = createFakeEm()
    const first = await startEvalRunCommand.execute(
      { ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile() },
      ctxFor(em),
    )
    await startEvalRunCommand.execute({ ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile() }, ctxFor(em))

    const second = storeFor(AgentEvalSuiteRun).find((row) => row.id !== first.suiteRunId) as Row
    const pointer = readEvalSetPointer(second.summary)
    expect(pointer?.carrierSuiteRunId).toBe(first.suiteRunId)
    expect(pointer?.body).toBeUndefined()
    expect(pointer?.source).toBe('file')
  })

  it('rejects an invalid file with a 422 carrying the validation issues', async () => {
    const { em, storeFor } = createFakeEm()
    const invalid = { ...sampleFile(), cases: [{ key: 'dup', input: {} }, { key: 'dup', input: {} }] }

    await expect(
      startEvalRunCommand.execute({ ...SCOPE, agentDefinitionId: AGENT, evalSet: invalid }, ctxFor(em)),
    ).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({
        code: 'eval_set_file_invalid',
        issues: expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('cases') })]),
      }),
    })
    expect(storeFor(AgentEvalSuiteRun)).toHaveLength(0)
  })

  it('rejects an unknown scorer with a 422', async () => {
    const { em } = createFakeEm()
    const file = sampleFile()
    const invalid = {
      ...file,
      assertions: [{ key: 'x', scorerKey: 'no_such_scorer', severity: 'gate', title: 'X', config: {} }],
    }

    await expect(
      startEvalRunCommand.execute({ ...SCOPE, agentDefinitionId: AGENT, evalSet: invalid }, ctxFor(em)),
    ).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'eval_set_file_invalid' }) })
  })

  it('rejects a file for a different agent with a 422', async () => {
    const { em } = createFakeEm()

    await expect(
      startEvalRunCommand.execute({ ...SCOPE, agentDefinitionId: 'other.agent', evalSet: sampleFile() }, ctxFor(em)),
    ).rejects.toMatchObject({ status: 422, body: expect.objectContaining({ code: 'eval_set_agent_mismatch' }) })
  })

  it('rejects a file that exceeds the manifest size cap with a 422', async () => {
    const { em } = createFakeEm()
    const previous = process.env.OM_AGENT_EVAL_SET_MAX_BYTES
    process.env.OM_AGENT_EVAL_SET_MAX_BYTES = '200'
    try {
      await expect(
        startEvalRunCommand.execute({ ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile() }, ctxFor(em)),
      ).rejects.toMatchObject({ status: 422 })
    } finally {
      if (previous === undefined) delete process.env.OM_AGENT_EVAL_SET_MAX_BYTES
      else process.env.OM_AGENT_EVAL_SET_MAX_BYTES = previous
    }
  })

  it('refuses to combine evalSet with snapshot or evalSetVersion', async () => {
    const { em } = createFakeEm()
    await expect(
      startEvalRunCommand.execute(
        { ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile(), snapshot: 'latest' },
        ctxFor(em),
      ),
    ).rejects.toThrow(/evalSet cannot be combined with snapshot/)
    await expect(
      startEvalRunCommand.execute(
        { ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile(), evalSetVersion: 'release-1' },
        ctxFor(em),
      ),
    ).rejects.toThrow(/evalSetVersion cannot be combined with evalSet/)
  })

  it('keeps the database path unchanged when no file is given', async () => {
    const { em, storeFor } = createFakeEm([
      [AgentEvalCase, [{ id: DB_CASE, ...SCOPE, agentDefinitionId: AGENT, status: 'approved', deletedAt: null, input: {} }]],
    ])

    await startEvalRunCommand.execute({ ...SCOPE, agentDefinitionId: AGENT, evalCaseIds: [DB_CASE] }, ctxFor(em))

    const [suite] = storeFor(AgentEvalSuiteRun)
    expect(suite.evalSetVersion).toBeNull()
    expect(readEvalSetPointer(suite.summary)?.source).toBe('db')
    expect(storeFor(AgentEvalCaseRun).map((row) => row.evalCaseId)).toEqual([DB_CASE])
  })
})

describe('replaying a file-sourced suite run', () => {
  beforeEach(() => {
    resetEvalSetManifestCache()
    jest.mocked(emitAgentOrchestratorEvent).mockClear()
  })

  it('runs the frozen file case and reports progress with the suite agent id', async () => {
    const { em, storeFor } = createFakeEm([
      [AgentRun, [{ id: 'run-1', ...SCOPE, agentId: AGENT, status: 'completed', output: { answer: 'a golden answer' } }]],
    ])
    const caseA = deterministicCaseId(AGENT, 'case-a')
    await startEvalRunCommand.execute(
      { ...SCOPE, agentDefinitionId: AGENT, evalSet: sampleFile(), evalCaseIds: [caseA] },
      ctxFor(em),
    )
    const [caseRun] = storeFor(AgentEvalCaseRun)
    const runtime = {
      run: jest.fn(async (_agentId: string, _input: unknown, ctx: { onRunPersisted?: (runId: string) => void }) => {
        ctx.onRunPersisted?.('run-1')
        return {}
      }),
    }
    const container = { resolve: (name: string) => (name === 'em' ? em : runtime) } as unknown as AwilixContainer

    const outcome = await executeCaseRun(container, caseRun.id as string, SCOPE, 'user-1')

    expect(runtime.run).toHaveBeenCalledWith(AGENT, { question: 'first' }, expect.anything())
    expect(outcome.status).toBe('passed')
    expect(storeFor(AgentEvalResult).map((row) => row.assertionId)).toEqual([
      deterministicAssertionId(AGENT, 'mentions_golden'),
    ])
    const completed = jest
      .mocked(emitAgentOrchestratorEvent)
      .mock.calls.find(([eventId]) => eventId === 'agent_orchestrator.eval_case_run.completed')
    expect(completed?.[1]).toEqual(expect.objectContaining({ agentDefinitionId: AGENT, evalCaseId: caseA }))
  })
})

describe('report of a file-sourced suite run', () => {
  it('shows the file source, case keys and scorer keys from the frozen manifest', async () => {
    const { manifest, version } = manifestFromFile(parseEvalSetFile(sampleFile()))
    const caseA = deterministicCaseId(AGENT, 'case-a')
    const assertionId = deterministicAssertionId(AGENT, 'mentions_golden')
    const createdAt = new Date('2026-10-22T10:00:00.000Z')
    const { em } = createFakeEm([
      [
        AgentEvalSuiteRun,
        [
          {
            id: 'suite-1',
            ...SCOPE,
            agentDefinitionId: AGENT,
            releaseId: null,
            trigger: 'ci',
            status: 'completed',
            outcome: 'passed',
            judgeMayGate: false,
            repeatCount: 1,
            caseCount: 1,
            errorCount: 0,
            evalSetVersion: version,
            passScore: 1,
            scoreVariance: null,
            baselineSuiteRunId: null,
            summary: {
              [EVAL_SET_SUMMARY_KEY]: {
                version,
                label: manifest.label,
                source: 'file',
                caseCount: 2,
                assertionCount: 1,
                carrierSuiteRunId: 'suite-1',
                body: manifest,
              },
            },
            startedAt: createdAt,
            finishedAt: createdAt,
            createdAt,
          },
        ],
      ],
      [
        AgentEvalCaseRun,
        [
          {
            id: 'cr-1',
            ...SCOPE,
            suiteRunId: 'suite-1',
            evalCaseId: caseA,
            agentRunId: null,
            trialIndex: 0,
            status: 'passed',
            score: 1,
            passed: true,
            latencyMs: 10,
            costMinor: null,
            errorMessage: null,
            createdAt,
          },
        ],
      ],
      [
        AgentEvalResult,
        [
          {
            id: 'res-1',
            ...SCOPE,
            agentRunId: null,
            evalCaseRunId: 'cr-1',
            assertionId,
            assertionKey: 'mentions_golden',
            passed: true,
            score: 1,
            severity: 'gate',
            evidence: { matched: true },
          },
        ],
      ],
      [AgentEvalAssertion, []],
    ])

    const report = await buildEvalReport(em, SCOPE, 'suite-1', { env: {} })

    expect(report?.evalSet).toEqual(expect.objectContaining({ source: 'file', manifestHash: version, pinKind: 'hash' }))
    expect(report?.cases).toHaveLength(1)
    expect(report?.cases[0]).toEqual(
      expect.objectContaining({ id: caseA, key: 'case-a', name: 'First case', source: 'file' }),
    )
    expect(report?.cases[0].trials[0].results[0]).toEqual(
      expect.objectContaining({ assertionKey: 'mentions_golden', scorerKey: 'regex', type: 'deterministic' }),
    )
    expect(report?.assertions[0]).toEqual(expect.objectContaining({ key: 'mentions_golden', scorerKey: 'regex' }))
  })
})

describe('runEvalGate with file cases', () => {
  it('starts the run from the file and never queries eval case rows', async () => {
    const replay = jest.spyOn(replayModule, 'replaySuiteRun')
    const { em, queried } = createFakeEm()
    const execute = jest.fn(async (commandId: string) => {
      if (commandId === 'agent_orchestrator.evalRuns.start') {
        return { result: { suiteRunId: 'suite-file', caseRunCount: 2 } }
      }
      return { result: { suiteRunId: 'suite-file', status: 'completed', outcome: 'passed', passScore: 1 } }
    })
    replay.mockResolvedValue(undefined)
    const container = {
      resolve: (name: string) => (name === 'em' ? em : { execute }),
    } as unknown as AwilixContainer
    const cases: EvalSetFile = parseEvalSetFile(sampleFile())

    try {
      const result = await runEvalGate(container, { agentDefinitionId: AGENT, scope: SCOPE, cases })

      expect(queried).not.toContain(AgentEvalCase)
      const startCall = execute.mock.calls.find(([commandId]) => commandId === 'agent_orchestrator.evalRuns.start') as
        | unknown[]
        | undefined
      const startInput = (startCall?.[1] as { input: Row }).input
      expect(startInput.evalSet).toBe(cases)
      expect(startInput.evalCaseIds).toBeUndefined()
      expect(startInput.snapshot).toBeUndefined()
      expect(result.outcome).toBe('passed')
    } finally {
      replay.mockRestore()
    }
  })
})
