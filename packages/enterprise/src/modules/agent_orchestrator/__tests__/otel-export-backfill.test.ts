import { describe, expect, jest, test } from '@jest/globals'
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
