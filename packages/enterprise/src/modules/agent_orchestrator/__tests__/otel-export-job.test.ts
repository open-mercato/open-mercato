import { beforeEach, describe, expect, jest, test } from '@jest/globals'

const reportError = jest.fn()
const recordOtelExportHealth = jest.fn<(...args: unknown[]) => Promise<void>>()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

jest.mock('../lib/trace/otel/exportHealth', () => ({
  recordOtelExportHealth: (...args: unknown[]) => recordOtelExportHealth(...args),
}))

import {
  OTEL_EXPORT_BACKOFF_MAX_MS,
  OTEL_EXPORT_ERROR_CODES,
  enqueueOtelExportForRunEvent,
  otelExportBackoffMs,
  processOtelExportJob,
  readDeploymentEnvironment,
} from '../lib/trace/otel/exportJob'
import type { RunExportBundle, RunExportRun, RunExportSpan } from '../lib/trace/otel/loadRunExportBundle'
import type { OtlpExportResult, PostOtlpTracesInput } from '../lib/trace/otel/otlpHttpClient'
import type { OtelExportJobPayload } from '../lib/queue'
import { metadata as workerMetadata } from '../workers/otel-export'
import { metadata as completedMetadata } from '../subscribers/otel-export-run-completed'
import { metadata as ingestedMetadata } from '../subscribers/otel-export-run-ingested'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const ENDPOINT = 'http://collector.test:4318/v1/traces'

const ENABLED_ENV = {
  OM_AGENT_OTEL_EXPORT: 'on',
  OM_AGENT_OTEL_EXPORT_ENDPOINT: ENDPOINT,
  OM_AGENT_OTEL_EXPORT_HEADERS: 'authorization=Bearer%20token-value',
  OM_AGENT_OTEL_EXPORT_DELAY_MS: '1500',
  OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=om,deployment.environment.name=staging',
}

const T0 = new Date('2026-10-27T10:00:00.000Z')

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

function buildSpan(index: number): RunExportSpan {
  const id = `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
  return {
    id,
    externalSpanId: id,
    parentSpanId: null,
    sequence: index,
    name: `step-${index}`,
    kind: 'system',
    status: 'ok',
    startedAt: new Date(T0.getTime() + index),
    endedAt: new Date(T0.getTime() + index + 1),
    durationMs: 1,
    attributes: null,
  }
}

function buildBundle(overrides: Partial<RunExportBundle> = {}): RunExportBundle {
  const run = overrides.run ?? buildRun()
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
    ...overrides,
  }
}

function makeContainer(settingsValues: unknown[] | unknown) {
  const values = Array.isArray(settingsValues) ? [...settingsValues] : [settingsValues]
  const getRecord = jest.fn(async (_moduleId: string, _name: string, _scope?: { tenantId?: string | null }) => {
    const value = values.length > 1 ? values.shift() : values[0]
    return value === null ? null : { value, source: 'tenant', updatedAt: '2026-10-27T09:00:00.000Z' }
  })
  return {
    getRecord,
    container: {
      resolve: (token: string) => {
        if (token === 'moduleConfigService') return { getRecord }
        throw new Error(`[internal] unexpected DI token in test: ${token}`)
      },
    },
  }
}

function result(outcome: OtlpExportResult['outcome'], fields: Partial<OtlpExportResult> = {}): OtlpExportResult {
  return { outcome, httpStatus: null, retryAfterMs: null, errorCode: null, latencyMs: 3, ...fields }
}

function makeJobDeps(options: {
  env?: Record<string, string | undefined>
  settings?: unknown
  bundle?: RunExportBundle | null
  results?: OtlpExportResult[]
  loadRejects?: boolean
}) {
  const { container, getRecord } = makeContainer(options.settings ?? { enabled: true })
  const queued = [...(options.results ?? [result('ok', { httpStatus: 200 })])]
  const post = jest.fn(async (_input: PostOtlpTracesInput) => (queued.length > 1 ? queued.shift() : queued[0]) as OtlpExportResult)
  const enqueue = jest.fn(async (_payload: OtelExportJobPayload, _options?: { delayMs?: number }) => 'job-id')
  const loadBundle = jest.fn(async (_runId: string) => {
    if (options.loadRejects) throw new Error('db down')
    return options.bundle === undefined ? buildBundle() : options.bundle
  })
  return {
    getRecord,
    post,
    enqueue,
    loadBundle,
    deps: { container: container as never, loadBundle, post, enqueue, env: options.env ?? ENABLED_ENV },
  }
}

beforeEach(() => {
  reportError.mockReset()
  recordOtelExportHealth.mockReset()
  recordOtelExportHealth.mockResolvedValue(undefined)
})

describe('otel export wiring metadata', () => {
  test('worker and subscribers are bound to the export queue and run events', () => {
    expect(workerMetadata).toEqual({
      queue: 'agent-orchestrator-otel-export',
      id: 'agent_orchestrator:otel-export',
      concurrency: 2,
    })
    expect(completedMetadata).toEqual({
      event: 'agent_orchestrator.run.completed',
      persistent: true,
      id: 'agent_orchestrator:otel-export-run-completed',
    })
    expect(ingestedMetadata).toEqual({
      event: 'agent_orchestrator.run.ingested',
      persistent: true,
      id: 'agent_orchestrator:otel-export-run-ingested',
    })
  })
})

describe('enqueueOtelExportForRunEvent', () => {
  const event = { id: RUN_ID, agentId: 'sales.quote_drafter', tenantId: TENANT_ID, organizationId: ORG_ID }

  test('skips without reading settings when the deployment switch is off', async () => {
    const { container, getRecord } = makeContainer({ enabled: true })
    const enqueue = jest.fn(async () => 'job-id')
    const enqueued = await enqueueOtelExportForRunEvent(event, container, { enqueue, env: {} })
    expect(enqueued).toBe(false)
    expect(getRecord).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('skips when the tenant has not opted in', async () => {
    const { container } = makeContainer(null)
    const enqueue = jest.fn(async () => 'job-id')
    expect(await enqueueOtelExportForRunEvent(event, container, { enqueue, env: ENABLED_ENV })).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('skips an agent outside the tenant allowlist', async () => {
    const { container } = makeContainer({ enabled: true, agentAllowlist: ['other.agent'] })
    const enqueue = jest.fn(async () => 'job-id')
    expect(await enqueueOtelExportForRunEvent(event, container, { enqueue, env: ENABLED_ENV })).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('enqueues the run id with attempt 0 and the deployment delay', async () => {
    const { container, getRecord } = makeContainer({ enabled: true })
    const enqueue = jest.fn(async (_payload: OtelExportJobPayload, _options?: { delayMs?: number }) => 'job-id')
    expect(await enqueueOtelExportForRunEvent(event, container, { enqueue, env: ENABLED_ENV })).toBe(true)
    expect(getRecord).toHaveBeenCalledWith('agent_orchestrator', 'otel_export', { tenantId: TENANT_ID })
    expect(enqueue).toHaveBeenCalledWith({ runId: RUN_ID, attempt: 0 }, { delayMs: 1500 })
  })

  test('ignores a payload without a run id or tenant', async () => {
    const { container } = makeContainer({ enabled: true })
    const enqueue = jest.fn(async () => 'job-id')
    expect(await enqueueOtelExportForRunEvent({ id: RUN_ID }, container, { enqueue, env: ENABLED_ENV })).toBe(false)
    expect(await enqueueOtelExportForRunEvent(null, container, { enqueue, env: ENABLED_ENV })).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('never throws when enqueueing fails and reports the error', async () => {
    const { container } = makeContainer({ enabled: true })
    const enqueue = jest.fn(async () => {
      throw new Error('redis down')
    })
    await expect(enqueueOtelExportForRunEvent(event, container, { enqueue, env: ENABLED_ENV })).resolves.toBe(false)
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.enqueueFailed }),
    )
  })
})

describe('processOtelExportJob', () => {
  const payload: OtelExportJobPayload = { runId: RUN_ID, attempt: 0 }

  test('is a no-op when the deployment is disabled', async () => {
    const harness = makeJobDeps({ env: {} })
    expect(await processOtelExportJob(payload, harness.deps)).toBe('disabled')
    expect(harness.loadBundle).not.toHaveBeenCalled()
    expect(harness.post).not.toHaveBeenCalled()
  })

  test('is a no-op when the run is missing or still running', async () => {
    const harness = makeJobDeps({ bundle: null })
    expect(await processOtelExportJob(payload, harness.deps)).toBe('missing_run')
    expect(harness.post).not.toHaveBeenCalled()
    expect(recordOtelExportHealth).not.toHaveBeenCalled()
  })

  test('re-checks the tenant settings from the run row and refuses a revoked opt-in', async () => {
    const harness = makeJobDeps({ settings: { enabled: false } })
    expect(await processOtelExportJob(payload, harness.deps)).toBe('not_enabled')
    expect(harness.getRecord).toHaveBeenCalledWith('agent_orchestrator', 'otel_export', { tenantId: TENANT_ID })
    expect(harness.post).not.toHaveBeenCalled()
  })

  test('trusts only the run id: tenant, agent and source come from the row', async () => {
    const harness = makeJobDeps({
      settings: { enabled: true, agentAllowlist: ['sales.quote_drafter'] },
      bundle: buildBundle({ run: buildRun({ source: 'eval' }) }),
      env: { ...ENABLED_ENV, OM_AGENT_OTEL_EXPORT_SOURCES: 'runtime' },
    })
    const forged = { runId: RUN_ID, attempt: 0, tenantId: 'other-tenant', source: 'runtime' }
    expect(await processOtelExportJob(forged, harness.deps)).toBe('not_enabled')
    expect(harness.getRecord).toHaveBeenCalledWith('agent_orchestrator', 'otel_export', { tenantId: TENANT_ID })
    expect(harness.post).not.toHaveBeenCalled()
  })

  test('posts the encoded run and records success', async () => {
    const harness = makeJobDeps({})
    expect(await processOtelExportJob(payload, harness.deps)).toBe('exported')
    expect(harness.post).toHaveBeenCalledTimes(1)
    const input = harness.post.mock.calls[0][0]
    expect(input.endpoint).toBe(ENDPOINT)
    expect(input.headers).toEqual({ authorization: 'Bearer token-value' })
    const body = JSON.parse(input.body) as {
      resourceSpans: Array<{ resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> } }>
    }
    expect(body.resourceSpans).toHaveLength(1)
    const resource = body.resourceSpans[0].resource.attributes
    expect(resource).toEqual(
      expect.arrayContaining([
        { key: 'om.tenant.id', value: { stringValue: TENANT_ID } },
        { key: 'deployment.environment.name', value: { stringValue: 'staging' } },
      ]),
    )
    expect(recordOtelExportHealth).toHaveBeenCalledWith(expect.anything(), TENANT_ID, { outcome: 'success' })
    expect(harness.enqueue).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })

  test('posts one request per chunk for a large run', async () => {
    const spans = Array.from({ length: 1100 }, (_unused, index) => buildSpan(index + 1))
    const harness = makeJobDeps({ bundle: buildBundle({ spans }) })
    expect(await processOtelExportJob(payload, harness.deps)).toBe('exported')
    expect(harness.post).toHaveBeenCalledTimes(3)
  })

  test('re-enqueues a retryable failure with the next attempt and honors Retry-After', async () => {
    const harness = makeJobDeps({ results: [result('retry', { httpStatus: 429, retryAfterMs: 60_000, errorCode: 'http_429' })] })
    expect(await processOtelExportJob({ runId: RUN_ID, attempt: 1 }, harness.deps)).toBe('retry_scheduled')
    expect(harness.enqueue).toHaveBeenCalledWith({ runId: RUN_ID, attempt: 2 }, { delayMs: 60_000 })
    expect(reportError).not.toHaveBeenCalled()
    expect(recordOtelExportHealth).not.toHaveBeenCalled()
  })

  test('uses exponential backoff when the backend gives no Retry-After', async () => {
    const harness = makeJobDeps({ results: [result('retry', { errorCode: 'timeout' })] })
    expect(await processOtelExportJob({ runId: RUN_ID, attempt: 2 }, harness.deps)).toBe('retry_scheduled')
    expect(harness.enqueue).toHaveBeenCalledWith({ runId: RUN_ID, attempt: 3 }, { delayMs: otelExportBackoffMs(2) })
  })

  test('stops after the fifth attempt and reports the failure', async () => {
    const harness = makeJobDeps({ results: [result('retry', { httpStatus: 503, errorCode: 'http_503' })] })
    expect(await processOtelExportJob({ runId: RUN_ID, attempt: 4 }, harness.deps)).toBe('failed')
    expect(harness.enqueue).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: 'agent_orchestrator', code: OTEL_EXPORT_ERROR_CODES.failed }),
    )
    expect(recordOtelExportHealth).toHaveBeenCalledWith(expect.anything(), TENANT_ID, {
      outcome: 'error',
      errorCode: 'http_503',
    })
  })

  test('reports a rejected export without retrying', async () => {
    const harness = makeJobDeps({ results: [result('drop', { httpStatus: 400, errorCode: 'http_400' })] })
    expect(await processOtelExportJob(payload, harness.deps)).toBe('rejected')
    expect(harness.enqueue).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.rejected }),
    )
    expect(recordOtelExportHealth).toHaveBeenCalledWith(expect.anything(), TENANT_ID, {
      outcome: 'error',
      errorCode: 'http_400',
    })
  })

  test('stops posting the remaining chunks after a failed chunk', async () => {
    const spans = Array.from({ length: 1100 }, (_unused, index) => buildSpan(index + 1))
    const harness = makeJobDeps({
      bundle: buildBundle({ spans }),
      results: [result('ok', { httpStatus: 200 }), result('retry', { errorCode: 'network_error' })],
    })
    expect(await processOtelExportJob(payload, harness.deps)).toBe('retry_scheduled')
    expect(harness.post).toHaveBeenCalledTimes(2)
  })

  test('catches unexpected failures without rethrowing', async () => {
    const harness = makeJobDeps({ loadRejects: true })
    await expect(processOtelExportJob(payload, harness.deps)).resolves.toBe('error')
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.unexpected }),
    )
  })

  test('ignores a payload without a run id', async () => {
    const harness = makeJobDeps({})
    expect(await processOtelExportJob({ attempt: 0 }, harness.deps)).toBe('invalid_payload')
    expect(harness.loadBundle).not.toHaveBeenCalled()
  })
})

describe('export job helpers', () => {
  test('backoff grows exponentially from 5 s and is capped at 5 min', () => {
    expect(otelExportBackoffMs(0)).toBe(5_000)
    expect(otelExportBackoffMs(1)).toBe(10_000)
    expect(otelExportBackoffMs(3)).toBe(40_000)
    expect(otelExportBackoffMs(10)).toBe(OTEL_EXPORT_BACKOFF_MAX_MS)
  })

  test('reads the deployment environment from OTEL_RESOURCE_ATTRIBUTES', () => {
    expect(readDeploymentEnvironment({})).toBeNull()
    expect(readDeploymentEnvironment({ OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=prod' })).toBe('prod')
    expect(
      readDeploymentEnvironment({
        OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=legacy,deployment.environment.name=current',
      }),
    ).toBe('current')
  })
})
