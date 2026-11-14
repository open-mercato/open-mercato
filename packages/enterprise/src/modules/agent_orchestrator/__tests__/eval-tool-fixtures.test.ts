import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  buildRecordedToolFixture,
  computeToolArgsKey,
  emitRecordedToolFixture,
  resolveToolReplayDecision,
  type ToolReplayFixture,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'
import { AgentEvalCaseRun, AgentEvalSuiteRun, AgentRun } from '../data/entities'
import { startEvalRunCommand } from '../commands/evalRuns'
import { replaySuiteRun, resetEvalSetManifestCache } from '../lib/eval/evalReplayService'
import { EVAL_SET_FORMAT, mergeSuiteSummary } from '../lib/eval/manifest'
import {
  EVAL_RUN_SUMMARY_KEY,
  buildEvalRunSettings,
  readEvalRunCallSettings,
  readEvalRunToolMode,
  readEvalRunToolSummary,
  withEvalRunToolSummary,
} from '../lib/eval/evalRunSettings'
import {
  aggregateEvalToolMode,
  buildToolFixtureFile,
  conventionalToolFixturePath,
  createFileToolFixtureStore,
  fixtureFileSegment,
  parseEvalCliToolFixtureFlags,
  parseToolFixtureText,
  serializeToolFixtureFile,
  writeToolFixtureFile,
  type EvalToolFixtureCaseRef,
  type EvalToolFixtureLoad,
  type EvalToolFixtureOptions,
  type EvalToolFixtureStore,
} from '../lib/eval/toolFixtures'

jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn(async () => undefined) }))

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const AGENT = 'content_review.fixture_agent'

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

function evalSetFile(caseKeys: string[]): Record<string, unknown> {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId: AGENT,
    assertions: [],
    cases: caseKeys.map((key) => ({ key, input: { question: key } })),
  }
}

type ToolCallPlan = { toolName: string; args: unknown; isMutation?: boolean }

async function simulateToolCall(call: ToolCallPlan, handler: (args: unknown) => Promise<unknown>): Promise<unknown> {
  let decision: ReturnType<typeof resolveToolReplayDecision>
  try {
    decision = resolveToolReplayDecision({
      toolName: call.toolName,
      args: call.args,
      isMutation: call.isMutation === true,
      toolCallId: null,
    })
  } catch (error) {
    return { toolError: error instanceof Error ? error.message : String(error) }
  }
  if (decision.kind === 'replay') return decision.fixture.output
  const output = await handler(call.args)
  if (decision.kind === 'record') {
    emitRecordedToolFixture(decision.sink, buildRecordedToolFixture(decision.call, { output }))
  }
  return output
}

function memoryStore(byCaseKey: Record<string, EvalToolFixtureLoad> = {}) {
  const saved = new Map<string, ToolReplayFixture[]>()
  const store: EvalToolFixtureStore = {
    load: jest.fn(async (ref: EvalToolFixtureCaseRef) => byCaseKey[ref.caseKey] ?? { ok: false, reason: 'not_found' }),
    save: jest.fn(async (ref: EvalToolFixtureCaseRef, fixtures: ToolReplayFixture[]) => {
      saved.set(ref.caseKey, fixtures)
    }),
  }
  return { store, saved }
}

function fixture(toolName: string, args: unknown, output: unknown, occurrence = 0): ToolReplayFixture {
  return { toolName, argsKey: computeToolArgsKey(args), args, output, error: null, occurrence, toolCallId: null }
}

async function runSuite(input: {
  caseKeys: string[]
  plan: Record<string, ToolCallPlan[]>
  toolFixtures?: EvalToolFixtureOptions
  runtimeKind?: string
}) {
  const { em, storeFor } = createFakeEm()
  await startEvalRunCommand.execute(
    { ...SCOPE, agentDefinitionId: AGENT, evalSet: evalSetFile(input.caseKeys) },
    { container: { resolve: () => em } } as never,
  )
  const [suite] = storeFor(AgentEvalSuiteRun)
  const handler = jest.fn(async (args: unknown) => ({ live: true, args }))
  const observed: Record<string, unknown[]> = {}
  let runSeq = 0
  const runtime = {
    run: jest.fn(async (_agentId: string, caseInput: unknown, ctx: { onRunPersisted?: (runId: string) => void }) => {
      const runId = `run-${++runSeq}`
      storeFor(AgentRun).push({
        id: runId,
        ...SCOPE,
        agentId: AGENT,
        status: 'completed',
        output: {},
        runtime: input.runtimeKind ?? 'native',
      })
      ctx.onRunPersisted?.(runId)
      const key = (caseInput as { question: string }).question
      const outputs: unknown[] = []
      for (const call of input.plan[key] ?? []) outputs.push(await simulateToolCall(call, handler))
      observed[key] = outputs
      return {}
    }),
  }
  const container = { resolve: (name: string) => (name === 'em' ? em : runtime) } as unknown as AwilixContainer
  await replaySuiteRun(container, suite.id as string, SCOPE, 'user-1', input.toolFixtures ? { toolFixtures: input.toolFixtures } : {})
  const caseRuns = storeFor(AgentEvalCaseRun)
  const byKey = (key: string) => {
    const index = input.caseKeys.indexOf(key)
    return caseRuns[index]
  }
  return { suite, handler, observed, byKey, runtime }
}

describe('eval tool record/replay', () => {
  beforeEach(() => resetEvalSetManifestCache())

  it('record captures each case tool calls and stores them per case', async () => {
    const { store, saved } = memoryStore()
    const { suite, handler, byKey } = await runSuite({
      caseKeys: ['case-a'],
      plan: { 'case-a': [{ toolName: 'catalog.search', args: { q: 'a' } }, { toolName: 'catalog.search', args: { q: 'a' } }] },
      toolFixtures: { mode: 'record', store },
    })
    expect(handler).toHaveBeenCalledTimes(2)
    expect(byKey('case-a').status).not.toBe('error')
    const recorded = saved.get('case-a') ?? []
    expect(recorded.map((entry) => [entry.toolName, entry.occurrence])).toEqual([
      ['catalog.search', 0],
      ['catalog.search', 1],
    ])
    expect(recorded[0].output).toEqual({ live: true, args: { q: 'a' } })
    expect(readEvalRunToolSummary(suite.summary)).toMatchObject({ mode: 'record', requested: 'record', onMiss: null })
  })

  it('replay answers tool calls from fixtures without calling the handler', async () => {
    const { store } = memoryStore({
      'case-a': { ok: true, fidelity: 'full', fixtures: [fixture('catalog.search', { q: 'a' }, { recorded: 1 })] },
    })
    const { suite, handler, observed, byKey } = await runSuite({
      caseKeys: ['case-a'],
      plan: { 'case-a': [{ toolName: 'catalog.search', args: { q: 'a' } }] },
      toolFixtures: { mode: 'replay', store, onMiss: 'error' },
    })
    expect(handler).not.toHaveBeenCalled()
    expect(observed['case-a']).toEqual([{ recorded: 1 }])
    expect(byKey('case-a').status).not.toBe('error')
    expect(readEvalRunToolMode(suite.summary)).toBe('replay')
  })

  it('fails the case on a missing fixture even though the run itself succeeded', async () => {
    const { store } = memoryStore({ 'case-a': { ok: true, fidelity: 'full', fixtures: [] } })
    const { suite, handler, byKey } = await runSuite({
      caseKeys: ['case-a'],
      plan: { 'case-a': [{ toolName: 'catalog.search', args: { q: 'a' } }] },
      toolFixtures: { mode: 'replay', store, onMiss: 'error' },
    })
    expect(handler).not.toHaveBeenCalled()
    expect(byKey('case-a').status).toBe('error')
    expect(byKey('case-a').errorMessage).toContain('tool_fixture_missing')
    expect(byKey('case-a').errorMessage).not.toContain('"q"')
    expect(readEvalRunToolSummary(suite.summary)).toMatchObject({ mode: 'replay', misses: 1 })
  })

  it('falls back to the live tool with onMiss live and reports the suite as mixed', async () => {
    const { store } = memoryStore({ 'case-a': { ok: true, fidelity: 'full', fixtures: [] } })
    const { suite, handler, byKey } = await runSuite({
      caseKeys: ['case-a'],
      plan: { 'case-a': [{ toolName: 'catalog.search', args: { q: 'a' } }] },
      toolFixtures: { mode: 'replay', store, onMiss: 'live' },
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(byKey('case-a').status).not.toBe('error')
    expect(readEvalRunToolSummary(suite.summary)).toMatchObject({
      mode: 'mixed',
      onMiss: 'live',
      cases: { mixed: 1, replay: 0 },
    })
  })

  it('refuses mutation tools under replay and errors the case', async () => {
    const { store } = memoryStore({
      'case-a': { ok: true, fidelity: 'full', fixtures: [fixture('orders.update', { id: 1 }, { ok: true })] },
    })
    const { handler, byKey } = await runSuite({
      caseKeys: ['case-a'],
      plan: { 'case-a': [{ toolName: 'orders.update', args: { id: 1 }, isMutation: true }] },
      toolFixtures: { mode: 'replay', store, onMiss: 'live' },
    })
    expect(handler).not.toHaveBeenCalled()
    expect(byKey('case-a').status).toBe('error')
    expect(byKey('case-a').errorMessage).toContain('tool_replay_mutation_refused')
  })

  it('isolates fixtures and occurrence counters per case', async () => {
    const { store } = memoryStore({
      'case-a': { ok: true, fidelity: 'full', fixtures: [fixture('catalog.search', { q: 'shared' }, { from: 'a' })] },
      'case-b': { ok: true, fidelity: 'full', fixtures: [fixture('catalog.search', { q: 'shared' }, { from: 'b' })] },
      'case-c': { ok: true, fidelity: 'full', fixtures: [] },
    })
    const { observed, byKey } = await runSuite({
      caseKeys: ['case-a', 'case-b', 'case-c'],
      plan: {
        'case-a': [{ toolName: 'catalog.search', args: { q: 'shared' } }],
        'case-b': [{ toolName: 'catalog.search', args: { q: 'shared' } }],
        'case-c': [{ toolName: 'catalog.search', args: { q: 'shared' } }],
      },
      toolFixtures: { mode: 'replay', store, onMiss: 'error' },
    })
    expect(observed['case-a']).toEqual([{ from: 'a' }])
    expect(observed['case-b']).toEqual([{ from: 'b' }])
    expect(byKey('case-c').status).toBe('error')
  })

  it('runs cases without a configured fixture live and reports the suite as mixed', async () => {
    const { store } = memoryStore({
      'case-a': { ok: true, fidelity: 'summary', fixtures: [fixture('catalog.search', { q: 'a' }, { recorded: 1 })] },
      'case-b': { ok: false, reason: 'not_configured' },
    })
    const { suite, handler } = await runSuite({
      caseKeys: ['case-a', 'case-b'],
      plan: {
        'case-a': [{ toolName: 'catalog.search', args: { q: 'a' } }],
        'case-b': [{ toolName: 'catalog.search', args: { q: 'b' } }],
      },
      toolFixtures: { mode: 'replay', store, onMiss: 'error' },
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(readEvalRunToolSummary(suite.summary)).toMatchObject({
      mode: 'mixed',
      cases: { replay: 1, live: 1 },
      summaryFidelityCases: 1,
    })
  })

  it('errors the case on an invalid fixture file before running the agent', async () => {
    const { store } = memoryStore({ 'case-a': { ok: false, reason: 'invalid', message: 'not valid JSON' } })
    const { runtime, byKey } = await runSuite({
      caseKeys: ['case-a'],
      plan: {},
      toolFixtures: { mode: 'replay', store, onMiss: 'error' },
    })
    expect(runtime.run).not.toHaveBeenCalled()
    expect(byKey('case-a').errorMessage).toContain('tool_fixture_invalid')
  })

  it('reports OpenCode runs as unsupported_runtime and writes no fixture', async () => {
    const { store } = memoryStore()
    const { suite } = await runSuite({
      caseKeys: ['case-a'],
      plan: {},
      runtimeKind: 'opencode',
      toolFixtures: { mode: 'record', store },
    })
    expect(store.save).not.toHaveBeenCalled()
    expect(readEvalRunToolMode(suite.summary)).toBe('unsupported_runtime')
  })

  it('stores nothing and leaves the tool mode live without fixture options', async () => {
    const { suite, handler } = await runSuite({
      caseKeys: ['case-a'],
      plan: { 'case-a': [{ toolName: 'catalog.search', args: { q: 'a' } }] },
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(readEvalRunToolSummary(suite.summary)).toBeNull()
    expect(readEvalRunToolMode(suite.summary)).toBe('live')
  })
})

describe('eval-run tool summary', () => {
  it('keeps call settings next to the tool summary and survives suite completion', () => {
    const start = { [EVAL_RUN_SUMMARY_KEY]: buildEvalRunSettings({ seed: 3 }) }
    const withTools = withEvalRunToolSummary(start, {
      mode: 'replay',
      requested: 'replay',
      onMiss: 'error',
      cases: { live: 0, replay: 2, record: 0, mixed: 0, unsupported_runtime: 0 },
      misses: 0,
      summaryFidelityCases: 0,
    })
    const completed = mergeSuiteSummary(withTools, { some_assertion: { passed: 1 } })
    expect(readEvalRunCallSettings(completed)).toEqual({ seed: 3 })
    expect(readEvalRunToolMode(completed)).toBe('replay')
  })

  it('aggregates per-case modes', () => {
    expect(aggregateEvalToolMode([])).toBe('live')
    expect(aggregateEvalToolMode(['replay', 'replay'])).toBe('replay')
    expect(aggregateEvalToolMode(['replay', 'live'])).toBe('mixed')
    expect(aggregateEvalToolMode(['replay', 'mixed'])).toBe('mixed')
    expect(aggregateEvalToolMode(['unsupported_runtime'])).toBe('unsupported_runtime')
  })
})

describe('tool fixture files', () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-eval-fixtures-'))
  })
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const ref = (caseKey: string, fixturePath: string | null = null): EvalToolFixtureCaseRef => ({
    agentId: AGENT,
    caseKey,
    fixturePath,
    trialIndex: 0,
  })

  it('round-trips a recorded file and marks it as tenant data', async () => {
    const store = createFileToolFixtureStore({ recordDir: tmpDir, replayDir: tmpDir })
    await store.save(ref('case-a'), [fixture('catalog.search', { q: 'a' }, { hits: 2 })])
    const filePath = conventionalToolFixturePath(tmpDir, AGENT, 'case-a')
    expect(filePath.endsWith(path.join(AGENT, 'case-a.tools.json'))).toBe(true)
    const written = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Row
    expect(written.containsTenantData).toBe(true)
    expect(written.fidelity).toBe('full')
    const loaded = await store.load(ref('case-a'))
    expect(loaded).toMatchObject({ ok: true, fidelity: 'full', fixtures: [{ toolName: 'catalog.search', output: { hits: 2 } }] })
  })

  it('recomputes argsKey from args and rejects duplicate occurrences', () => {
    const file = buildToolFixtureFile({ agentId: AGENT, caseKey: 'k', fixtures: [fixture('t', { a: 1 }, 1)] })
    const edited = { ...file, fixtures: [{ ...file.fixtures[0], args: { a: 2 }, argsKey: 'stale' }] }
    const parsed = parseToolFixtureText(JSON.stringify(edited))
    expect(parsed.ok && parsed.fixtures[0].argsKey).toBe(computeToolArgsKey({ a: 2 }))
    const duplicated = { ...file, fixtures: [file.fixtures[0], file.fixtures[0]] }
    expect(parseToolFixtureText(JSON.stringify(duplicated))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(parseToolFixtureText('nope')).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('enforces the byte cap on write and read', () => {
    const file = buildToolFixtureFile({ agentId: AGENT, caseKey: 'k', fixtures: [fixture('t', {}, 'x'.repeat(500))] })
    expect(() => serializeToolFixtureFile(file, 100)).toThrow(/tool_fixture_record_failed/)
    const filePath = path.join(tmpDir, 'big.tools.json')
    writeToolFixtureFile(filePath, file)
    const store = createFileToolFixtureStore({ evalSetDir: tmpDir, maxBytes: 100 })
    return expect(store.load(ref('k', 'big.tools.json'))).resolves.toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('resolves case fixture paths inside the eval-set directory only', () => {
    const store = createFileToolFixtureStore({ evalSetDir: tmpDir })
    expect(store.resolveReplayPath(ref('k', 'fixtures/a.tools.json'))).toBe(path.join(tmpDir, 'fixtures/a.tools.json'))
    expect(store.resolveReplayPath(ref('k', '../outside.json'))).toBeNull()
    expect(store.resolveReplayPath(ref('k'))).toBeNull()
    const explicit = createFileToolFixtureStore({ evalSetDir: tmpDir, replayDir: path.join(tmpDir, 'replay') })
    expect(explicit.resolveReplayPath(ref('k', 'fixtures/a.tools.json'))).toBe(
      path.join(tmpDir, 'replay', AGENT, 'k.tools.json'),
    )
  })

  it('fails a case whose fixture path leaves the eval-set directory instead of running it live', async () => {
    const store = createFileToolFixtureStore({ evalSetDir: tmpDir })
    expect(store.resolveReplayPath(ref('k', '..data/a.tools.json'))).toBe(path.join(tmpDir, '..data/a.tools.json'))
    await expect(store.load(ref('k', '../outside.tools.json'))).resolves.toMatchObject({ ok: false, reason: 'invalid' })
    await expect(store.load(ref('k', path.join(os.tmpdir(), 'abs.tools.json')))).resolves.toMatchObject({
      ok: false,
      reason: 'invalid',
    })
  })

  it('reports a missing file as not_found and an unconfigured case as not_configured', async () => {
    const store = createFileToolFixtureStore({ evalSetDir: tmpDir })
    await expect(store.load(ref('k', 'missing.tools.json'))).resolves.toEqual({ ok: false, reason: 'not_found' })
    await expect(store.load(ref('k'))).resolves.toEqual({ ok: false, reason: 'not_configured' })
  })

  it('maps unsafe keys to hashed file names', () => {
    expect(fixtureFileSegment('case-a.1')).toBe('case-a.1')
    expect(fixtureFileSegment('../etc/passwd')).toMatch(/^key-[0-9a-f]{32}$/)
    expect(fixtureFileSegment('a/b')).toMatch(/^key-[0-9a-f]{32}$/)
  })
})

describe('eval CLI tool fixture flags', () => {
  it('builds record and replay options', () => {
    const record = parseEvalCliToolFixtureFlags({ record: 'fixtures' })
    expect(record).toMatchObject({ ok: true, options: { mode: 'record' }, recordDir: path.resolve('fixtures') })
    const replay = parseEvalCliToolFixtureFlags({ replay: 'fixtures', onFixtureMiss: 'live' })
    expect(replay).toMatchObject({ ok: true, options: { mode: 'replay', onMiss: 'live' }, implicitReplay: false })
    expect(parseEvalCliToolFixtureFlags({ replay: 'fixtures' })).toMatchObject({ options: { onMiss: 'error' } })
    expect(parseEvalCliToolFixtureFlags({})).toEqual({ ok: true, options: null, recordDir: null, implicitReplay: false })
  })

  it('replays implicitly when a cases file references tool fixtures', () => {
    const result = parseEvalCliToolFixtureFlags({
      casesFile: { cases: [{ fixtures: { tools: 'fixtures/a.tools.json' } }, {}] },
      evalSetDir: '/tmp/evals',
    })
    expect(result).toMatchObject({ ok: true, implicitReplay: true, options: { mode: 'replay', onMiss: 'error' } })
  })

  it('rejects conflicting or dangling flags', () => {
    expect(parseEvalCliToolFixtureFlags({ record: 'a', replay: 'b' }).ok).toBe(false)
    expect(parseEvalCliToolFixtureFlags({ replay: 'a', onFixtureMiss: 'maybe' }).ok).toBe(false)
    expect(parseEvalCliToolFixtureFlags({ onFixtureMiss: 'live' }).ok).toBe(false)
    expect(parseEvalCliToolFixtureFlags({ record: 'a', onFixtureMiss: 'live' }).ok).toBe(false)
    expect(parseEvalCliToolFixtureFlags({ fixturesFromRun: 'run-1' }).ok).toBe(false)
    expect(parseEvalCliToolFixtureFlags({ fixturesFromRun: 'run-1', record: 'a' }).ok).toBe(true)
  })
})
