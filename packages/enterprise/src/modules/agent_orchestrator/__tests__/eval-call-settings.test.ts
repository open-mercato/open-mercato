import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { mergeCallSettings } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import { AgentEvalCase, AgentEvalCaseRun, AgentEvalSuiteRun, AgentRun } from '../data/entities'
import { evalRunCreateSchema } from '../data/validators'
import { startEvalRunCommand } from '../commands/evalRuns'
import * as replayModule from '../lib/eval/evalReplayService'
import { executeCaseRun, resetEvalSetManifestCache } from '../lib/eval/evalReplayService'
import { runEvalGate } from '../lib/eval/evalGate'
import { EVAL_SET_FORMAT, deterministicCaseId, mergeSuiteSummary } from '../lib/eval/manifest'
import {
  EVAL_RUN_SUMMARY_KEY,
  buildEvalRunSettings,
  parseEvalCliCallSettings,
  readEvalRunCallSettings,
} from '../lib/eval/evalRunSettings'
import { defineAgent, getAgentEntry } from '../lib/sdk/defineAgent'

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn(async () => undefined) }))

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const AGENT = 'content_review.settings_validator'
const DB_CASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type Row = Record<string, unknown>

function createFakeEm(seed: Array<[unknown, Row[]]> = []) {
  const stores = new Map<unknown, Row[]>(seed.map(([entity, rows]) => [entity, rows.map((row) => ({ ...row }))]))
  const pending: Row[] = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity) as Row[]
  }
  const matchValue = (actual: unknown, expected: unknown) => {
    if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
      return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
    }
    if (expected === null) return actual === null || actual === undefined
    return actual === expected
  }
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => matchValue(row[key], value))
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
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
    async refresh() {
      return undefined
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function ctxFor(em: EntityManager) {
  return { container: { resolve: () => em } } as never
}

function sampleFile(): Record<string, unknown> {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId: AGENT,
    assertions: [],
    cases: [{ key: 'case-a', input: { question: 'first' } }],
  }
}

describe('eval-run call settings helpers', () => {
  it('drops unknown keys and stores nothing when no setting is given', () => {
    expect(buildEvalRunSettings(undefined)).toBeNull()
    expect(buildEvalRunSettings({})).toBeNull()
    expect(buildEvalRunSettings({ temperature: 0, seed: 3 })).toEqual({ callSettings: { temperature: 0, seed: 3 } })
  })

  it('reads stored settings and ignores malformed entries', () => {
    expect(readEvalRunCallSettings({ [EVAL_RUN_SUMMARY_KEY]: { callSettings: { seed: 9 } } })).toEqual({ seed: 9 })
    expect(readEvalRunCallSettings({ [EVAL_RUN_SUMMARY_KEY]: { callSettings: { temperature: -1 } } })).toBeNull()
    expect(readEvalRunCallSettings({ [EVAL_RUN_SUMMARY_KEY]: { callSettings: { nope: 1 } } })).toBeNull()
    expect(readEvalRunCallSettings({ [EVAL_RUN_SUMMARY_KEY]: 'x' })).toBeNull()
    expect(readEvalRunCallSettings(null)).toBeNull()
    expect(readEvalRunCallSettings({})).toBeNull()
  })

  it('survives suite completion because reserved summary keys are preserved', () => {
    const existing = { [EVAL_RUN_SUMMARY_KEY]: { callSettings: { seed: 1 } } }
    const merged = mergeSuiteSummary(existing, { some_assertion: { passed: 1 } }, { __judgeDeltas: [] })
    expect(readEvalRunCallSettings(merged)).toEqual({ seed: 1 })
  })

  it('parses the CLI --temperature and --seed flags', () => {
    expect(parseEvalCliCallSettings({})).toEqual({ ok: true, value: null })
    expect(parseEvalCliCallSettings({ temperature: '0', seed: '42' })).toEqual({
      ok: true,
      value: { temperature: 0, seed: 42 },
    })
    expect(parseEvalCliCallSettings({ temperature: '-0.5' }).ok).toBe(false)
    expect(parseEvalCliCallSettings({ temperature: 'hot' }).ok).toBe(false)
    expect(parseEvalCliCallSettings({ seed: '1.5' }).ok).toBe(false)
    expect(parseEvalCliCallSettings({ seed: '' }).ok).toBe(false)
  })
})

describe('POST /eval-runs body callSettings', () => {
  const base = { agentDefinitionId: AGENT, evalCaseIds: [DB_CASE] }

  it('accepts capped settings', () => {
    const parsed = evalRunCreateSchema.parse({ ...base, callSettings: { temperature: 0.2, seed: 5 } })
    expect(parsed.callSettings).toEqual({ temperature: 0.2, seed: 5 })
  })

  it('rejects providerOptions, out-of-range values and unknown keys', () => {
    expect(evalRunCreateSchema.safeParse({ ...base, callSettings: { providerOptions: { openai: {} } } }).success).toBe(false)
    expect(evalRunCreateSchema.safeParse({ ...base, callSettings: { temperature: 3 } }).success).toBe(false)
    expect(evalRunCreateSchema.safeParse({ ...base, callSettings: { maxOutputTokens: 1_000_000 } }).success).toBe(false)
    expect(evalRunCreateSchema.safeParse({ ...base, callSettings: { mystery: 1 } }).success).toBe(false)
  })
})

describe('evalRuns.start records callSettings', () => {
  const dbSeed = (): Array<[unknown, Row[]]> => [
    [AgentEvalCase, [{ id: DB_CASE, ...SCOPE, agentDefinitionId: AGENT, status: 'approved', deletedAt: null, input: {} }]],
  ]

  it('persists the eval-run settings as summary.__evalRun', async () => {
    const { em, storeFor } = createFakeEm(dbSeed())
    await startEvalRunCommand.execute(
      { ...SCOPE, agentDefinitionId: AGENT, evalCaseIds: [DB_CASE], callSettings: { temperature: 0, seed: 11 } },
      ctxFor(em),
    )
    const [suite] = storeFor(AgentEvalSuiteRun)
    expect((suite.summary as Row)[EVAL_RUN_SUMMARY_KEY]).toEqual({ callSettings: { temperature: 0, seed: 11 } })
  })

  it('stores no entry when the run has no overrides', async () => {
    const { em, storeFor } = createFakeEm(dbSeed())
    await startEvalRunCommand.execute({ ...SCOPE, agentDefinitionId: AGENT, evalCaseIds: [DB_CASE] }, ctxFor(em))
    const [suite] = storeFor(AgentEvalSuiteRun)
    expect(EVAL_RUN_SUMMARY_KEY in (suite.summary as Row)).toBe(false)
  })

  it('allows providerOptions server-side and rejects invalid settings', async () => {
    const { em, storeFor } = createFakeEm(dbSeed())
    await startEvalRunCommand.execute(
      {
        ...SCOPE,
        agentDefinitionId: AGENT,
        evalCaseIds: [DB_CASE],
        callSettings: { providerOptions: { openai: { reasoningEffort: 'low' } } },
      },
      ctxFor(em),
    )
    expect(readEvalRunCallSettings(storeFor(AgentEvalSuiteRun)[0].summary)).toEqual({
      providerOptions: { openai: { reasoningEffort: 'low' } },
    })

    await expect(
      startEvalRunCommand.execute(
        { ...SCOPE, agentDefinitionId: AGENT, evalCaseIds: [DB_CASE], callSettings: { temperature: -1 } },
        ctxFor(em),
      ),
    ).rejects.toThrow()
    expect(storeFor(AgentEvalSuiteRun)).toHaveLength(1)
  })
})

describe('replay forwards eval-run callSettings to the runtime', () => {
  beforeEach(() => resetEvalSetManifestCache())

  async function replayOnce(callSettings?: Record<string, unknown>) {
    const { em, storeFor } = createFakeEm([[AgentRun, [{ id: 'run-1', ...SCOPE, agentId: AGENT, status: 'completed', output: {} }]]])
    await startEvalRunCommand.execute(
      {
        ...SCOPE,
        agentDefinitionId: AGENT,
        evalSet: sampleFile(),
        evalCaseIds: [deterministicCaseId(AGENT, 'case-a')],
        ...(callSettings ? { callSettings } : {}),
      },
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
    await executeCaseRun(container, caseRun.id as string, SCOPE, 'user-1')
    return runtime.run.mock.calls[0][2] as Row
  }

  it('passes the stored settings on the run ctx', async () => {
    const ctx = await replayOnce({ temperature: 0, seed: 21 })
    expect(ctx.callSettings).toEqual({ temperature: 0, seed: 21 })
    expect(ctx.entryPoint).toBe('eval')
  })

  it('sends no callSettings when the suite run has none, leaving the agent modelSettings in force', async () => {
    const ctx = await replayOnce()
    expect('callSettings' in ctx).toBe(false)
  })
})

describe('runEvalGate forwards callSettings', () => {
  it('hands the settings to evalRuns.start', async () => {
    const replay = jest.spyOn(replayModule, 'replaySuiteRun').mockResolvedValue(undefined)
    const { em } = createFakeEm()
    const execute = jest.fn(async (commandId: string) => {
      if (commandId === 'agent_orchestrator.evalRuns.start') return { result: { suiteRunId: 'suite-1', caseRunCount: 1 } }
      return { result: { suiteRunId: 'suite-1', status: 'completed', outcome: 'passed', passScore: 1 } }
    })
    const container = { resolve: (name: string) => (name === 'em' ? em : { execute }) } as unknown as AwilixContainer
    try {
      await runEvalGate(container, {
        agentDefinitionId: AGENT,
        scope: SCOPE,
        snapshot: 'latest',
        callSettings: { temperature: 0, seed: 4 },
      })
      const startCall = execute.mock.calls.find(([commandId]) => commandId === 'agent_orchestrator.evalRuns.start') as
        | unknown[]
        | undefined
      expect((startCall?.[1] as { input: Row }).input.callSettings).toEqual({ temperature: 0, seed: 4 })
    } finally {
      replay.mockRestore()
    }
  })
})

describe('defineAgent modelSettings', () => {
  const schema = z.object({ kind: z.literal('research'), data: z.unknown() })
  const baseAgent = {
    moduleId: 'eval_call_settings_tests',
    label: 'Settings agent',
    description: 'Agent used by the call settings tests.',
    instructions: 'inform',
    result: { kind: 'research' as const, schema },
  }

  it('forwards modelSettings to the ai-assistant definition and the registry entry', () => {
    const definition = defineAgent({ ...baseAgent, id: 'eval_call_settings.with_settings', modelSettings: { temperature: 0.3, seed: 1 } })
    expect(definition.modelSettings).toEqual({ temperature: 0.3, seed: 1 })
    expect(getAgentEntry('eval_call_settings.with_settings')?.modelSettings).toEqual({ temperature: 0.3, seed: 1 })
  })

  it('leaves modelSettings unset when the agent declares none', () => {
    const definition = defineAgent({ ...baseAgent, id: 'eval_call_settings.without_settings' })
    expect(definition.modelSettings).toBeUndefined()
    expect(getAgentEntry('eval_call_settings.without_settings')?.modelSettings).toBeUndefined()
  })

  it('rejects invalid modelSettings at registration', () => {
    expect(() =>
      defineAgent({
        ...baseAgent,
        id: 'eval_call_settings.invalid_settings',
        modelSettings: { temperature: -1 },
      }),
    ).toThrow(/invalid modelSettings/)
    expect(getAgentEntry('eval_call_settings.invalid_settings')).toBeUndefined()
  })

  it('lets eval callSettings win key by key over the agent modelSettings', () => {
    const definition = defineAgent({
      ...baseAgent,
      id: 'eval_call_settings.precedence',
      modelSettings: { temperature: 0.7, seed: 1, maxOutputTokens: 500 },
    })
    const evalOverride = readEvalRunCallSettings({ [EVAL_RUN_SUMMARY_KEY]: { callSettings: { temperature: 0, seed: 9 } } })
    expect(mergeCallSettings(definition.modelSettings, evalOverride ?? undefined)).toEqual({
      temperature: 0,
      seed: 9,
      maxOutputTokens: 500,
    })
  })
})
