import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import {
  OTEL_EXPORT_BACKFILL_DEFAULT_LIMIT,
  buildOtelExportBackfillFilter,
  buildOtelExportDryRunLines,
  formatOtelExportBackfillSkips,
  parseOtelExportBackfillArgs,
  runOtelExportBackfill,
  type OtelExportBackfillArgs,
  type OtelExportBackfillFilter,
  type OtelExportBackfillRunRow,
} from '../lib/trace/otel/exportBackfill'
import { OTEL_EXPORT_DEFAULT_SERVICE_NAME } from '../lib/trace/otel/exportSettings'
import type { RunExportBundle, RunExportRun } from '../lib/trace/otel/loadRunExportBundle'
import type { OtelExportJobPayload } from '../lib/queue'

const mockSelectRuns = jest.fn<(entity: unknown, filter: unknown, options: unknown) => Promise<OtelExportBackfillRunRow[]>>()
const mockLoadBundle = jest.fn<(source: unknown, runId: string) => Promise<RunExportBundle | null>>()
const mockQueueEnqueue = jest.fn<(payload: unknown, options?: unknown) => Promise<string>>()
const mockEntityManager = {
  find: (entity: unknown, filter: unknown, options: unknown) => mockSelectRuns(entity, filter, options),
  fork: () => mockEntityManager,
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEntityManager
      throw new Error(`[internal] unexpected DI token in test: ${key}`)
    },
  })),
}))

jest.mock('../lib/trace/otel/loadRunExportBundle', () => ({
  ...(jest.requireActual('../lib/trace/otel/loadRunExportBundle') as Record<string, unknown>),
  loadRunExportBundle: (source: unknown, runId: string) => mockLoadBundle(source, runId),
}))

jest.mock('../lib/queue', () => ({
  ...(jest.requireActual('../lib/queue') as Record<string, unknown>),
  getAgentOrchestratorQueue: () => ({ enqueue: (payload: unknown, options?: unknown) => mockQueueEnqueue(payload, options) }),
}))

jest.mock('../lib/processes/processProjection', () => ({
  recomputeProcessInstance: jest.fn(),
}))

import cliCommands from '../cli'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '44444444-4444-4444-8444-444444444444'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const SECOND_RUN_ID = '55555555-5555-4555-8555-555555555555'
const T0 = new Date('2026-10-27T10:00:00.000Z')

const ENABLED_ENV = {
  OM_AGENT_OTEL_EXPORT: 'on',
  OM_AGENT_OTEL_EXPORT_ENDPOINT: 'http://collector.test:4318/v1/traces',
  OM_AGENT_OTEL_SERVICE_NAME: 'agents-staging',
}

function buildRun(overrides: Partial<RunExportRun> = {}): RunExportRun {
  return {
    id: RUN_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    agentId: 'sales.quote_drafter',
    source: 'runtime',
    status: 'ok',
    parentRunId: null,
    rerunOfRunId: null,
    workflowInstanceId: null,
    stepId: null,
    invocationId: null,
    proposalId: null,
    agentVersion: '3',
    model: 'gpt-test',
    runtime: 'native',
    confidence: 0.8,
    inputTokens: 120,
    outputTokens: 40,
    costMinor: 2,
    currency: 'USD',
    latencyMs: 5000,
    resultKind: 'proposal',
    agentType: 'decision_maker',
    createdAt: T0,
    completedAt: new Date(T0.getTime() + 5000),
    ...overrides,
  }
}

function buildBundle(run: RunExportRun = buildRun()): RunExportBundle {
  return {
    run,
    rootRunId: run.id,
    agentLabel: 'Quote drafter',
    manifest: null,
    spans: [],
    effectorSpans: [],
    toolCalls: [],
    proposals: [],
    evalResults: [],
    guardrailChecks: [],
    processInstance: null,
  }
}

function row(overrides: Partial<OtelExportBackfillRunRow> = {}): OtelExportBackfillRunRow {
  return { id: RUN_ID, tenantId: TENANT_ID, organizationId: ORG_ID, agentId: 'sales.quote_drafter', source: 'runtime', ...overrides }
}

function parsedArgs(rest: string[]): OtelExportBackfillArgs {
  const result = parseOtelExportBackfillArgs(rest)
  if (!result.ok) throw new Error(`[internal] unexpected parse failure: ${result.error}`)
  return result.args
}

function makeDeps(options: {
  env?: Record<string, string | undefined>
  runs?: OtelExportBackfillRunRow[]
  settingsByTenant?: Record<string, unknown>
  bundles?: Record<string, RunExportBundle | null>
}) {
  const getRecord = jest.fn(async (_moduleId: string, _name: string, scope?: { tenantId?: string | null }) => {
    const value = options.settingsByTenant?.[scope?.tenantId ?? '']
    return value === undefined ? null : { value, source: 'tenant', updatedAt: '2026-10-27T09:00:00.000Z' }
  })
  const selectRuns = jest.fn(async (_filter: OtelExportBackfillFilter, _limit: number) => options.runs ?? [])
  const loadBundle = jest.fn(async (runId: string) => options.bundles?.[runId] ?? null)
  const enqueue = jest.fn(async (_payload: OtelExportJobPayload, _options?: { delayMs?: number }) => undefined)
  const lines: string[] = []
  return {
    getRecord,
    selectRuns,
    loadBundle,
    enqueue,
    lines,
    deps: {
      container: {
        resolve: (token: string) => {
          if (token === 'moduleConfigService') return { getRecord }
          throw new Error(`[internal] unexpected DI token in test: ${token}`)
        },
      },
      selectRuns,
      loadBundle,
      enqueue,
      writeLine: (line: string) => {
        lines.push(line)
      },
      env: options.env ?? {},
    },
  }
}

describe('parseOtelExportBackfillArgs', () => {
  test('accepts a single run with defaults', () => {
    const result = parseOtelExportBackfillArgs(['--run', RUN_ID])
    expect(result).toEqual({ ok: true, args: { run: RUN_ID, limit: OTEL_EXPORT_BACKFILL_DEFAULT_LIMIT, dryRun: false } })
  })

  test('accepts a window with tenant, limit and dry-run in any order', () => {
    const result = parseOtelExportBackfillArgs([
      '--dry-run',
      '--since',
      '2026-10-01T00:00:00Z',
      '--until',
      '2026-10-02T00:00:00.000+02:00',
      '--tenant',
      TENANT_ID,
      '--limit',
      '1000',
    ])
    expect(result).toEqual({
      ok: true,
      args: {
        since: '2026-10-01T00:00:00Z',
        until: '2026-10-02T00:00:00.000+02:00',
        tenant: TENANT_ID,
        limit: 1000,
        dryRun: true,
      },
    })
  })

  test.each([
    ['no selector', []],
    ['both selectors', ['--run', RUN_ID, '--since', '2026-10-01T00:00:00Z']],
    ['until without since', ['--run', RUN_ID, '--until', '2026-10-01T00:00:00Z']],
    ['until before since', ['--since', '2026-10-02T00:00:00Z', '--until', '2026-10-01T00:00:00Z']],
    ['until equal to since', ['--since', '2026-10-02T00:00:00Z', '--until', '2026-10-02T00:00:00Z']],
    ['non-uuid run', ['--run', 'abc']],
    ['non-uuid tenant', ['--run', RUN_ID, '--tenant', 'acme']],
    ['non-iso since', ['--since', 'yesterday']],
    ['limit zero', ['--run', RUN_ID, '--limit', '0']],
    ['limit above max', ['--run', RUN_ID, '--limit', '1001']],
    ['fractional limit', ['--run', RUN_ID, '--limit', '2.5']],
    ['non-numeric limit', ['--run', RUN_ID, '--limit', 'all']],
    ['missing value', ['--run']],
    ['flag as value', ['--run', '--dry-run']],
    ['duplicate option', ['--run', RUN_ID, '--run', RUN_ID]],
    ['unknown option', ['--run', RUN_ID, '--force']],
    ['positional token', [RUN_ID]],
  ])('rejects %s', (_label, rest) => {
    const result = parseOtelExportBackfillArgs(rest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('buildOtelExportBackfillFilter', () => {
  test('a run id selects that terminal run only', () => {
    expect(buildOtelExportBackfillFilter(parsedArgs(['--run', RUN_ID]))).toEqual({
      deletedAt: null,
      status: { $ne: 'running' },
      id: RUN_ID,
    })
  })

  test('a window is half-open on createdAt and scoped to the tenant', () => {
    const filter = buildOtelExportBackfillFilter(
      parsedArgs(['--since', '2026-10-01T00:00:00Z', '--until', '2026-10-02T00:00:00Z', '--tenant', TENANT_ID]),
    )
    expect(filter).toEqual({
      deletedAt: null,
      status: { $ne: 'running' },
      tenantId: TENANT_ID,
      createdAt: { $gte: new Date('2026-10-01T00:00:00Z'), $lt: new Date('2026-10-02T00:00:00Z') },
    })
  })

  test('an open-ended window has no upper bound', () => {
    const filter = buildOtelExportBackfillFilter(parsedArgs(['--since', '2026-10-01T00:00:00Z']))
    expect(filter.createdAt).toEqual({ $gte: new Date('2026-10-01T00:00:00Z') })
    expect(filter.tenantId).toBeUndefined()
  })
})

describe('buildOtelExportDryRunLines', () => {
  test('each line is a standalone OTLP JSON request with default service identity when the deployment is off', () => {
    const lines = buildOtelExportDryRunLines(buildBundle(), {})
    expect(lines).toHaveLength(1)
    const request = JSON.parse(lines[0]) as { resourceSpans: Array<{ resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> }; scopeSpans: Array<{ spans: unknown[] }> }> }
    expect(lines[0]).not.toContain('\n')
    expect(request.resourceSpans).toHaveLength(1)
    expect(request.resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(0)
    const serviceName = request.resourceSpans[0].resource.attributes.find((entry) => entry.key === 'service.name')
    expect(serviceName?.value.stringValue).toBe(OTEL_EXPORT_DEFAULT_SERVICE_NAME)
  })

  test('uses the configured service name when the deployment is on and never carries user ids', () => {
    const [line] = buildOtelExportDryRunLines(buildBundle(), ENABLED_ENV)
    expect(line).toContain('agents-staging')
    expect(line).not.toContain('enduser.id')
  })
})

describe('runOtelExportBackfill', () => {
  test('dry-run prints NDJSON without touching the queue or tenant settings, even with the deployment off', async () => {
    const harness = makeDeps({
      runs: [row(), row({ id: SECOND_RUN_ID })],
      bundles: { [RUN_ID]: buildBundle() },
    })
    const summary = await runOtelExportBackfill(parsedArgs(['--since', '2026-10-01T00:00:00Z', '--dry-run']), harness.deps)
    expect(summary).toEqual({ mode: 'dry_run', selected: 2, printed: 1, skipped: { not_found: 1 } })
    expect(harness.enqueue).not.toHaveBeenCalled()
    expect(harness.getRecord).not.toHaveBeenCalled()
    expect(harness.lines).toHaveLength(1)
    expect(JSON.parse(harness.lines[0])).toHaveProperty('resourceSpans')
  })

  test('refuses to enqueue when the deployment switch is off', async () => {
    const harness = makeDeps({ runs: [row()] })
    const summary = await runOtelExportBackfill(parsedArgs(['--run', RUN_ID]), harness.deps)
    expect(summary).toEqual({ mode: 'deployment_disabled', selected: 0 })
    expect(harness.selectRuns).not.toHaveBeenCalled()
    expect(harness.enqueue).not.toHaveBeenCalled()
  })

  test('enqueues only runs passing the tenant gate, immediately, and caches settings per tenant', async () => {
    const harness = makeDeps({
      env: ENABLED_ENV,
      runs: [
        row(),
        row({ id: SECOND_RUN_ID, source: 'playground' }),
        row({ id: '66666666-6666-4666-8666-666666666666', agentId: 'support.triage' }),
        row({ id: '77777777-7777-4777-8777-777777777777', tenantId: OTHER_TENANT_ID }),
      ],
      settingsByTenant: { [TENANT_ID]: { enabled: true, agentAllowlist: ['sales.quote_drafter'] } },
    })
    const summary = await runOtelExportBackfill(
      parsedArgs(['--since', '2026-10-01T00:00:00Z', '--limit', '50']),
      harness.deps,
    )
    expect(summary).toEqual({
      mode: 'enqueue',
      selected: 4,
      enqueued: 1,
      skipped: { source_not_exported: 1, agent_not_allowed: 1, tenant_disabled: 1 },
    })
    expect(harness.selectRuns).toHaveBeenCalledWith(expect.objectContaining({ status: { $ne: 'running' } }), 50)
    expect(harness.enqueue).toHaveBeenCalledTimes(1)
    expect(harness.enqueue).toHaveBeenCalledWith({ runId: RUN_ID, attempt: 0 }, { delayMs: 0 })
    expect(harness.getRecord).toHaveBeenCalledTimes(2)
    expect(harness.loadBundle).not.toHaveBeenCalled()
  })
})

describe('formatOtelExportBackfillSkips', () => {
  test('lists non-zero reasons in a stable order', () => {
    expect(formatOtelExportBackfillSkips({})).toBe('none')
    expect(formatOtelExportBackfillSkips({ tenant_disabled: 2, agent_not_allowed: 1, not_found: 0 })).toBe(
      'agent_not_allowed=1, tenant_disabled=2',
    )
  })
})

const LLM_SPAN_ID = '88888888-8888-4888-8888-888888888888'
const TOOL_SPAN_ID = '99999999-9999-4999-8999-999999999999'
const CONTENT_SENTINEL = 'otel-cli-sentinel-content'
const CONTENT_KEY_SEGMENTS = new Set(['input', 'output', 'payload', 'evidence'])

type DryRunAttribute = { key: string; value?: { stringValue?: string; intValue?: string | number } }
type DryRunSpan = { traceId: string; spanId: string; parentSpanId?: string; name: string; kind: number; attributes?: DryRunAttribute[] }
type DryRunRequest = {
  resourceSpans: Array<{
    resource: { attributes: DryRunAttribute[] }
    scopeSpans: Array<{ spans: DryRunSpan[] }>
  }>
}

function otelExportCommand(): ModuleCli {
  const command = cliCommands.find((entry) => entry.command === 'otel:export')
  if (!command) throw new Error('[internal] otel:export command missing')
  return command
}

function bundleWithSteps(): RunExportBundle {
  const bundle = buildBundle()
  return {
    ...bundle,
    spans: [
      {
        id: LLM_SPAN_ID,
        externalSpanId: 'llm-1',
        parentSpanId: null,
        sequence: 0,
        name: 'chat gpt-test',
        kind: 'llm',
        status: 'ok',
        startedAt: new Date(T0.getTime() + 100),
        endedAt: new Date(T0.getTime() + 900),
        durationMs: 800,
        attributes: {
          'gen_ai.provider.name': 'openai',
          'gen_ai.request.model': 'gpt-test',
          'gen_ai.usage.input_tokens': 120,
          'gen_ai.usage.output_tokens': 40,
          input: CONTENT_SENTINEL,
        },
      },
      {
        id: TOOL_SPAN_ID,
        externalSpanId: 'tool-1',
        parentSpanId: null,
        sequence: 1,
        name: 'customers.search',
        kind: 'tool',
        status: 'ok',
        startedAt: new Date(T0.getTime() + 1000),
        endedAt: new Date(T0.getTime() + 1200),
        durationMs: 200,
        attributes: null,
      },
    ],
    toolCalls: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        spanId: TOOL_SPAN_ID,
        toolName: 'customers.search',
        status: 'ok',
        isError: false,
        latencyMs: 200,
        createdAt: new Date(T0.getTime() + 1000),
      },
    ],
  }
}

function attributeValue(attributes: DryRunAttribute[] | undefined, key: string) {
  return (attributes ?? []).find((entry) => entry.key === key)?.value
}

function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into)
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.key === 'string') into.push(record.key)
    for (const [name, nested] of Object.entries(record)) {
      into.push(name)
      collectKeys(nested, into)
    }
  }
  return into
}

describe('otel:export CLI command', () => {
  const previousEnv = { ...process.env }
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    delete process.env.OM_AGENT_OTEL_EXPORT
    delete process.env.OM_AGENT_OTEL_EXPORT_ENDPOINT
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    mockSelectRuns.mockReset()
    mockLoadBundle.mockReset()
    mockQueueEnqueue.mockReset()
    stdout = []
    stderr = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk))
      return true
    })
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '))
    })
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    process.exitCode = undefined
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.env = { ...previousEnv }
    process.exitCode = undefined
  })

  test('--run --dry-run prints one OTLP/JSON request per line without touching the queue', async () => {
    mockSelectRuns.mockResolvedValue([row()])
    mockLoadBundle.mockResolvedValue(bundleWithSteps())

    await otelExportCommand().run(['--run', RUN_ID, '--dry-run'])

    expect(process.exitCode).toBeUndefined()
    expect(mockQueueEnqueue).not.toHaveBeenCalled()
    expect(mockLoadBundle).toHaveBeenCalledWith(mockEntityManager, RUN_ID)
    expect(mockSelectRuns.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ id: RUN_ID }))
    const lines = stdout.join('').split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]) as DryRunRequest
    const resource = parsed.resourceSpans[0].resource
    expect(attributeValue(resource.attributes, 'om.tenant.id')?.stringValue).toBe(TENANT_ID)
    expect(attributeValue(resource.attributes, 'service.name')?.stringValue).toBe(OTEL_EXPORT_DEFAULT_SERVICE_NAME)

    const spans = parsed.resourceSpans.flatMap((entry) => entry.scopeSpans.flatMap((scope) => scope.spans))
    const root = spans.find((span) => span.name === 'invoke_agent sales.quote_drafter')
    expect(root).toBeDefined()
    expect(root!.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(attributeValue(root!.attributes, 'om.run.id')?.stringValue).toBe(RUN_ID)
    const chat = spans.find((span) => span.name.startsWith('chat '))
    expect(chat?.parentSpanId).toBe(root!.spanId)
    expect(Number(attributeValue(chat!.attributes, 'gen_ai.usage.input_tokens')?.intValue)).toBe(120)
    expect(spans.find((span) => span.name === 'execute_tool customers.search')).toBeDefined()
    for (const span of spans) expect(span.traceId).toBe(root!.traceId)

    const contentKeys = collectKeys(parsed).filter((key) => key.split('.').some((segment) => CONTENT_KEY_SEGMENTS.has(segment)))
    expect(contentKeys).toEqual([])
    expect(lines[0]).not.toContain(CONTENT_SENTINEL)
    expect(stderr.join('\n')).toContain('Dry run: 1/1 run(s) printed')
  })

  test('without --dry-run a disabled deployment exits 1 and enqueues nothing', async () => {
    await otelExportCommand().run(['--run', RUN_ID])
    expect(process.exitCode).toBe(1)
    expect(mockSelectRuns).not.toHaveBeenCalled()
    expect(mockQueueEnqueue).not.toHaveBeenCalled()
    expect(stdout).toEqual([])
  })

  test('invalid arguments exit 2 with the usage', async () => {
    await otelExportCommand().run(['--run', 'not-a-uuid', '--dry-run'])
    expect(process.exitCode).toBe(2)
    expect(mockSelectRuns).not.toHaveBeenCalled()
    expect(stderr.length).toBeGreaterThan(0)
  })
})
