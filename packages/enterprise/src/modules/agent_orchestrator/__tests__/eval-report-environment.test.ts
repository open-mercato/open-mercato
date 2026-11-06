import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentEvalCaseRun, AgentEvalSuiteRun, AgentRun, AgentSpan } from '../data/entities'
import { buildEvalReport } from '../lib/eval/report/buildEvalReport'
import {
  buildEnvironmentWarnings,
  buildReportModelSettings,
  resolveEffectiveModelSettings,
  resolveSeedHonored,
  TOOL_FIXTURE_SUMMARY_FIDELITY_WARNING,
} from '../lib/eval/report/reportEnvironment'
import { evalReportSchema } from '../lib/eval/report/reportSchema'
import { getAgentEntry } from '../lib/sdk/defineAgent'

jest.mock('../lib/sdk/defineAgent', () => ({
  ...jest.requireActual('../lib/sdk/defineAgent'),
  getAgentEntry: jest.fn(),
}))

const mockedGetAgentEntry = getAgentEntry as jest.MockedFunction<typeof getAgentEntry>

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const OTHER_SCOPE = { tenantId: 'tenant-2', organizationId: 'org-2' }
const FIXED_NOW = () => new Date('2026-10-22T12:00:00.000Z')

type Row = Record<string, unknown>

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

function createFakeEm(seed: Map<unknown, Row[]>) {
  const storeFor = (entity: unknown) => seed.get(entity) ?? []
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => matchValue(row[key], value))
  const em = {
    async findOne(entity: unknown, where: Row) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
    fork: () => em,
  }
  return em as unknown as EntityManager
}

function suiteRun(summary: unknown): Row {
  return {
    id: 'suite-1',
    ...SCOPE,
    agentDefinitionId: 'agent-a',
    releaseId: null,
    trigger: 'ci',
    status: 'completed',
    outcome: 'passed',
    judgeMayGate: false,
    repeatCount: 1,
    evalSetVersion: null,
    passScore: 1,
    scoreVariance: null,
    baselineSuiteRunId: null,
    summary,
    startedAt: new Date('2026-10-22T10:00:00.000Z'),
    finishedAt: new Date('2026-10-22T10:05:00.000Z'),
    createdAt: new Date('2026-10-22T10:00:00.000Z'),
  }
}

function caseRun(id: string, agentRunId: string): Row {
  return {
    id,
    ...SCOPE,
    suiteRunId: 'suite-1',
    evalCaseId: `case-${id}`,
    agentRunId,
    trialIndex: 0,
    status: 'passed',
    score: 1,
    latencyMs: 100,
    costMinor: 1,
    errorMessage: null,
    createdAt: new Date('2026-10-22T10:01:00.000Z'),
  }
}

function agentRun(id: string, overrides: Row = {}): Row {
  return { id, ...SCOPE, agentId: 'agent-a', model: 'model-x', parentRunId: null, ...overrides }
}

let spanCounter = 0

function llmSpan(agentRunId: string, attributes: Row | null, overrides: Row = {}): Row {
  spanCounter += 1
  return { id: `span-${spanCounter}`, ...SCOPE, agentRunId, kind: 'llm', attributes, ...overrides }
}

function genAi(seed: number | undefined, provider = 'openai'): Row {
  return {
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': provider,
    ...(seed !== undefined ? { 'gen_ai.request.seed': seed } : {}),
  }
}

function seedWith(summary: unknown, spans: Row[], extraRuns: Row[] = []): Map<unknown, Row[]> {
  return new Map<unknown, Row[]>([
    [AgentEvalSuiteRun, [suiteRun(summary)]],
    [AgentEvalCaseRun, [caseRun('cr-1', 'run-1'), caseRun('cr-2', 'run-2')]],
    [AgentRun, [agentRun('run-1'), agentRun('run-2'), ...extraRuns]],
    [AgentSpan, spans],
  ])
}

function evalRunSummary(entry: Row): Row {
  return { __evalRun: entry }
}

async function build(seed: Map<unknown, Row[]>) {
  const report = await buildEvalReport(createFakeEm(seed), SCOPE, 'suite-1', { now: FIXED_NOW, env: {} })
  expect(() => evalReportSchema.parse(report)).not.toThrow()
  return report
}

beforeEach(() => {
  mockedGetAgentEntry.mockReset()
  mockedGetAgentEntry.mockReturnValue(undefined)
})

describe('report environment helpers', () => {
  it('merges eval-run callSettings over the agent modelSettings key by key', () => {
    expect(
      resolveEffectiveModelSettings({ temperature: 0.7, topP: 0.9, seed: 1 }, { temperature: 0, seed: 42 }),
    ).toEqual({ temperature: 0, topP: 0.9, seed: 42 })
    expect(resolveEffectiveModelSettings(null, null)).toEqual({})
    expect(resolveEffectiveModelSettings({ maxOutputTokens: 100 }, null)).toEqual({ maxOutputTokens: 100 })
  })

  it('never reports provider option values, only that they were set', () => {
    const settings = buildReportModelSettings(
      { temperature: 0, providerOptions: { openai: { user: 'end-user-42', apiKey: 'sk-secret' } } },
      [],
    )
    expect(settings).toEqual({ temperature: 0, providerOptionsPresent: true })
    expect(JSON.stringify(settings)).not.toContain('sk-secret')
    expect(JSON.stringify(settings)).not.toContain('end-user-42')
    expect(buildReportModelSettings({ providerOptions: {} }, [])).toEqual({})
  })

  it('resolves seed honored from the recorded llm calls', () => {
    expect(resolveSeedHonored(42, [])).toBe('unknown')
    expect(resolveSeedHonored(42, [{ seed: 42 }, { seed: 42 }])).toBe('yes')
    expect(resolveSeedHonored(42, [{ seed: 42 }, { seed: 7 }])).toBe('no')
    expect(resolveSeedHonored(42, [{ seed: 42 }, {}])).toBe('no')
  })

  it('warns only when summary-fidelity fixtures were replayed', () => {
    expect(buildEnvironmentWarnings(null)).toEqual([])
    const tools = {
      mode: 'replay' as const,
      requested: 'replay' as const,
      onMiss: 'error' as const,
      cases: { live: 0, replay: 2, record: 0, mixed: 0, unsupported_runtime: 0 },
      misses: 0,
      summaryFidelityCases: 0,
    }
    expect(buildEnvironmentWarnings(tools)).toEqual([])
    const warnings = buildEnvironmentWarnings({ ...tools, summaryFidelityCases: 2 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(new RegExp(`^${TOOL_FIXTURE_SUMMARY_FIDELITY_WARNING}: 2 case\\(s\\)`))
  })
})

describe('buildEvalReport environment block', () => {
  it('keeps the minimal environment for a run without settings, spans or fixtures', async () => {
    const report = await build(seedWith(null, []))
    expect(report?.environment).toEqual({
      models: ['model-x'],
      modelSettings: {},
      toolMode: 'live',
      modelMode: 'live',
      gitSha: null,
      cliVersion: null,
    })
  })

  it('reports the effective settings: eval-run callSettings over the agent modelSettings', async () => {
    mockedGetAgentEntry.mockReturnValue({
      modelSettings: { temperature: 0.8, maxOutputTokens: 512, providerOptions: { openai: { user: 'u-1' } } },
    } as unknown as ReturnType<typeof getAgentEntry>)
    const report = await build(seedWith(evalRunSummary({ callSettings: { temperature: 0 } }), []))
    expect(mockedGetAgentEntry).toHaveBeenCalledWith('agent-a')
    expect(report?.environment.modelSettings).toEqual({
      temperature: 0,
      maxOutputTokens: 512,
      providerOptionsPresent: true,
    })
    expect(JSON.stringify(report)).not.toContain('u-1')
  })

  it('reads the agent modelSettings when the eval run sets nothing', async () => {
    mockedGetAgentEntry.mockReturnValue({ modelSettings: { topP: 0.5 } } as unknown as ReturnType<typeof getAgentEntry>)
    const report = await build(seedWith(null, []))
    expect(report?.environment.modelSettings).toEqual({ topP: 0.5 })
  })

  it('marks the seed honored when every llm span in the run tree recorded it', async () => {
    const report = await build(
      seedWith(
        evalRunSummary({ callSettings: { seed: 42 } }),
        [llmSpan('run-1', genAi(42)), llmSpan('run-2', genAi(42, 'anthropic')), llmSpan('child-1', genAi(42))],
        [agentRun('child-1', { parentRunId: 'run-1' })],
      ),
    )
    expect(report?.environment.modelSettings.seed).toEqual({ requested: 42, honored: 'yes' })
    expect(report?.environment.providers).toEqual(['anthropic', 'openai'])
  })

  it('marks the seed not honored when a delegated child run sent another seed or none', async () => {
    const mismatch = await build(
      seedWith(
        evalRunSummary({ callSettings: { seed: 42 } }),
        [llmSpan('run-1', genAi(42)), llmSpan('child-1', genAi(7))],
        [agentRun('child-1', { parentRunId: 'run-1' })],
      ),
    )
    expect(mismatch?.environment.modelSettings.seed).toEqual({ requested: 42, honored: 'no' })
    const missing = await build(
      seedWith(evalRunSummary({ callSettings: { seed: 42 } }), [llmSpan('run-1', genAi(42)), llmSpan('run-2', genAi(undefined))]),
    )
    expect(missing?.environment.modelSettings.seed).toEqual({ requested: 42, honored: 'no' })
  })

  it('reports an unknown seed outcome when no llm span recorded request metadata', async () => {
    const report = await build(
      seedWith(evalRunSummary({ callSettings: { seed: 42 } }), [
        llmSpan('run-1', null),
        llmSpan('run-1', { 'llm.input_tokens': 10 }),
        llmSpan('run-1', genAi(9), { kind: 'tool' }),
        llmSpan('run-1', genAi(9), { ...OTHER_SCOPE }),
      ]),
    )
    expect(report?.environment.modelSettings.seed).toEqual({ requested: 42, honored: 'unknown' })
    expect(report?.environment.providers).toBeUndefined()
  })

  it('adds a summary-fidelity warning when fixtures came from a stored run', async () => {
    const report = await build(
      seedWith(
        evalRunSummary({
          tools: {
            mode: 'replay',
            requested: 'replay',
            onMiss: 'error',
            cases: { live: 0, replay: 2, record: 0, mixed: 0, unsupported_runtime: 0 },
            misses: 0,
            summaryFidelityCases: 1,
          },
        }),
        [],
      ),
    )
    expect(report?.environment.toolMode).toBe('replay')
    expect(report?.environment.warnings).toEqual([expect.stringContaining(`${TOOL_FIXTURE_SUMMARY_FIDELITY_WARNING}: 1 case(s)`)])
  })
})

describe('report schema compatibility', () => {
  it('still accepts an environment block stored before the additive fields existed', () => {
    const report = {
      schema: 'open-mercato.agent-eval-report',
      schemaVersion: 1,
      generatedAt: '2026-10-22T12:00:00.000Z',
      status: 'completed',
      suiteRun: {
        id: 'suite-legacy',
        agentId: 'agent-a',
        trigger: 'ci',
        outcome: 'passed',
        passScore: 1,
        scoreVariance: null,
        repeatCount: 1,
        judgeMayGate: false,
        startedAt: null,
        finishedAt: null,
        releaseId: null,
      },
      evalSet: { version: null, pinKind: 'none', manifestHash: null, label: null, source: 'db', caseCount: 0, assertionCount: 0 },
      baseline: { suiteRunId: null, manifestHash: null, sameDataset: null, warnings: [] },
      environment: {
        models: [],
        modelSettings: {},
        toolMode: 'live',
        modelMode: 'live',
        gitSha: null,
        cliVersion: null,
      },
      totals: {
        cases: 0,
        trials: 0,
        passed: 0,
        failed: 0,
        errored: 0,
        skipped: 0,
        flakyCases: 0,
        costMinor: null,
        currency: null,
        latencyMs: { p50: null, p95: null, max: null },
        tokens: { input: null, output: null },
      },
      assertions: [],
      regressions: [],
      cases: [],
    }
    const parsed = evalReportSchema.parse(report)
    expect(parsed.environment.providers).toBeUndefined()
    expect(parsed.environment.warnings).toBeUndefined()
  })
})
