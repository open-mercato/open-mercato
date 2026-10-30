import { beforeEach, describe, expect, jest, test } from '@jest/globals'

const reportError = jest.fn()
const recordOtelExportHealth = jest.fn<(...args: unknown[]) => Promise<void>>()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

jest.mock('../lib/trace/otel/exportHealth', () => ({
  recordOtelExportHealth: (...args: unknown[]) => recordOtelExportHealth(...args),
}))

const loadRunExportContent = jest.fn<(...args: unknown[]) => Promise<unknown>>()

jest.mock('../lib/trace/otel/loadRunExportContent', () => ({
  loadRunExportContent: (...args: unknown[]) => loadRunExportContent(...args),
}))

import {
  OTEL_EXPORT_BACKOFF_MAX_MS,
  OTEL_EXPORT_ERROR_CODES,
  OTEL_EXPORT_MAX_REQUEST_BYTES,
  encodeOtlpRequestBodies,
  OTEL_EXPORT_RETRY_AFTER_MAX_MS,
  enqueueOtelExportForFinishedProcess,
  enqueueOtelExportForRunEvent,
  otelExportBackoffMs,
  processOtelExportJob,
  readDeploymentEnvironment,
} from '../lib/trace/otel/exportJob'
import type { RunExportBundle, RunExportRun, RunExportSpan } from '../lib/trace/otel/loadRunExportBundle'
import type { RunExportContent } from '../lib/trace/otel/loadRunExportContent'
import type { OtelContentExportMode } from '../lib/trace/otel/exportSettings'
import type { OtlpExportResult, PostOtlpTracesInput } from '../lib/trace/otel/otlpHttpClient'
import type { OtelExportJobPayload } from '../lib/queue'
import type { ExportableTopLevelRunFilter } from '../lib/trace/otel/exportJob'
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
  enqueueRejects?: boolean
}) {
  const { container, getRecord } = makeContainer(options.settings ?? { enabled: true })
  const queued = [...(options.results ?? [result('ok', { httpStatus: 200 })])]
  const post = jest.fn(async (_input: PostOtlpTracesInput) => (queued.length > 1 ? queued.shift() : queued[0]) as OtlpExportResult)
  const enqueue = jest.fn(async (_payload: OtelExportJobPayload, _options?: { delayMs?: number }) => {
    if (options.enqueueRejects) throw new Error('redis down')
    return 'job-id'
  })
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
  loadRunExportContent.mockReset()
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

  test('reports a failed enqueue without rethrowing so the other persistent subscribers are not re-run', async () => {
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

  test('swallows a settings read failure without enqueueing', async () => {
    const getRecord = jest.fn(async () => {
      throw new Error('db down')
    })
    const container = { resolve: () => ({ getRecord }) }
    const enqueue = jest.fn(async () => 'job-id')
    await expect(enqueueOtelExportForRunEvent(event, container, { enqueue, env: ENABLED_ENV })).resolves.toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
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

  test('re-enqueues an unexpected failure with the next attempt and backoff', async () => {
    const harness = makeJobDeps({ loadRejects: true })
    await expect(processOtelExportJob({ runId: RUN_ID, attempt: 1 }, harness.deps)).resolves.toBe('retry_scheduled')
    expect(harness.enqueue).toHaveBeenCalledWith({ runId: RUN_ID, attempt: 2 }, { delayMs: otelExportBackoffMs(1) })
    expect(reportError).not.toHaveBeenCalled()
  })

  test('gives up on an unexpected failure after the fifth attempt and reports it', async () => {
    const harness = makeJobDeps({ loadRejects: true })
    await expect(processOtelExportJob({ runId: RUN_ID, attempt: 4 }, harness.deps)).resolves.toBe('error')
    expect(harness.enqueue).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.unexpected }),
    )
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.failed }),
    )
  })

  test('records the health error when an unexpected post failure exhausts the attempts', async () => {
    const harness = makeJobDeps({})
    const post = async () => {
      throw new Error('encoder crashed')
    }
    const outcome = await processOtelExportJob({ runId: RUN_ID, attempt: 4 }, { ...harness.deps, post })
    expect(outcome).toBe('error')
    expect(recordOtelExportHealth).toHaveBeenCalledWith(expect.anything(), TENANT_ID, {
      outcome: 'error',
      errorCode: 'unexpected',
    })
  })

  test('reports and gives up when re-enqueueing an unexpected failure throws', async () => {
    const harness = makeJobDeps({ loadRejects: true, enqueueRejects: true })
    await expect(processOtelExportJob(payload, harness.deps)).resolves.toBe('error')
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.enqueueFailed }),
    )
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.unexpected }),
    )
  })

  test('caps a huge Retry-After at one hour', async () => {
    const harness = makeJobDeps({ results: [result('retry', { httpStatus: 503, retryAfterMs: 7 * 24 * 3600 * 1000 })] })
    expect(await processOtelExportJob(payload, harness.deps)).toBe('retry_scheduled')
    expect(OTEL_EXPORT_RETRY_AFTER_MAX_MS).toBe(3_600_000)
    expect(harness.enqueue).toHaveBeenCalledWith({ runId: RUN_ID, attempt: 1 }, { delayMs: OTEL_EXPORT_RETRY_AFTER_MAX_MS })
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

describe('enqueueOtelExportForFinishedProcess', () => {
  const WORKFLOW_INSTANCE_ID = '55555555-5555-4555-8555-555555555555'
  const finished = { id: WORKFLOW_INSTANCE_ID, workflowInstanceId: WORKFLOW_INSTANCE_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

  function makeFinder(runId: string | null) {
    return jest.fn(async (_filter: ExportableTopLevelRunFilter) => runId)
  }

  test('skips without reading settings or runs when the deployment switch is off', async () => {
    const { container, getRecord } = makeContainer({ enabled: true })
    const enqueue = jest.fn(async () => 'job-id')
    const findLatestTopLevelRunId = makeFinder(RUN_ID)
    expect(await enqueueOtelExportForFinishedProcess(finished, container, { enqueue, findLatestTopLevelRunId, env: {} })).toBe(false)
    expect(getRecord).not.toHaveBeenCalled()
    expect(findLatestTopLevelRunId).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('skips when the tenant has not opted in', async () => {
    const { container } = makeContainer(null)
    const enqueue = jest.fn(async () => 'job-id')
    const findLatestTopLevelRunId = makeFinder(RUN_ID)
    expect(await enqueueOtelExportForFinishedProcess(finished, container, { enqueue, findLatestTopLevelRunId, env: ENABLED_ENV })).toBe(false)
    expect(findLatestTopLevelRunId).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('ignores a payload without tenant, organization or workflow instance', async () => {
    const { container } = makeContainer({ enabled: true })
    const enqueue = jest.fn(async () => 'job-id')
    const findLatestTopLevelRunId = makeFinder(RUN_ID)
    const deps = { enqueue, findLatestTopLevelRunId, env: ENABLED_ENV }
    expect(await enqueueOtelExportForFinishedProcess({ ...finished, organizationId: undefined }, container, deps)).toBe(false)
    expect(await enqueueOtelExportForFinishedProcess({ ...finished, tenantId: '' }, container, deps)).toBe(false)
    expect(await enqueueOtelExportForFinishedProcess({ ...finished, workflowInstanceId: null }, container, deps)).toBe(false)
    expect(await enqueueOtelExportForFinishedProcess(null, container, deps)).toBe(false)
    expect(findLatestTopLevelRunId).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('selects the latest exportable top-level run in the event scope and enqueues it once', async () => {
    const { container } = makeContainer({ enabled: true, agentAllowlist: ['sales.quote_drafter'] })
    const enqueue = jest.fn(async (_payload: OtelExportJobPayload, _options?: { delayMs?: number }) => 'job-id')
    const findLatestTopLevelRunId = makeFinder(RUN_ID)
    expect(await enqueueOtelExportForFinishedProcess(finished, container, { enqueue, findLatestTopLevelRunId, env: ENABLED_ENV })).toBe(true)
    expect(findLatestTopLevelRunId).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      workflowInstanceId: WORKFLOW_INSTANCE_ID,
      sources: expect.arrayContaining(['runtime']),
      agentAllowlist: ['sales.quote_drafter'],
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith({ runId: RUN_ID, attempt: 0 }, { delayMs: 1500 })
  })

  test('does nothing when the process has no exportable agent run', async () => {
    const { container } = makeContainer({ enabled: true })
    const enqueue = jest.fn(async () => 'job-id')
    expect(
      await enqueueOtelExportForFinishedProcess(finished, container, { enqueue, findLatestTopLevelRunId: makeFinder(null), env: ENABLED_ENV }),
    ).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('reports a failed run lookup or enqueue without throwing', async () => {
    const { container } = makeContainer({ enabled: true })
    const failingFinder = jest.fn(async (_filter: ExportableTopLevelRunFilter): Promise<string | null> => {
      throw new Error('db down')
    })
    const enqueue = jest.fn(async () => 'job-id')
    await expect(
      enqueueOtelExportForFinishedProcess(finished, container, { enqueue, findLatestTopLevelRunId: failingFinder, env: ENABLED_ENV }),
    ).resolves.toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    const failingEnqueue = jest.fn(async () => {
      throw new Error('redis down')
    })
    await expect(
      enqueueOtelExportForFinishedProcess(finished, container, { enqueue: failingEnqueue, findLatestTopLevelRunId: makeFinder(RUN_ID), env: ENABLED_ENV }),
    ).resolves.toBe(false)
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: OTEL_EXPORT_ERROR_CODES.enqueueFailed }),
    )
  })
})

const LLM_SPAN_ID = '77777777-7777-4777-8777-aaaaaaaaaaaa'
const CONTENT_SENTINEL = 'otel-job-sentinel-prompt'
const INFERENCE_EVENT = 'gen_ai.client.inference.operation.details'

function llmSpan(id: string, index: number): RunExportSpan {
  return {
    id,
    externalSpanId: id,
    parentSpanId: null,
    sequence: index,
    name: 'llm.step',
    kind: 'llm',
    status: 'ok',
    startedAt: new Date(T0.getTime() + index * 10),
    endedAt: new Date(T0.getTime() + index * 10 + 5),
    durationMs: 5,
    attributes: { 'gen_ai.request.model': 'gpt-test' },
  }
}

function llmContent(spanIds: string[], text: string): RunExportContent {
  return {
    bySpanId: new Map(
      spanIds.map((id) => [
        id,
        {
          status: 'exported' as const,
          request: { schema: 'om.llm_request.v1', system: text, messages: [{ role: 'user', content: text }], tools: [] },
          response: { schema: 'om.llm_response.v1', finishReason: 'stop', content: [{ type: 'text', text }] },
        },
      ]),
    ),
    toolCalls: new Map(),
  }
}

function capturedBundle(level: string | null, spans: RunExportSpan[] = [llmSpan(LLM_SPAN_ID, 1)]): RunExportBundle {
  return buildBundle({ manifest: level ? { 'om.capture': { level } } : null, spans })
}

const CONTENT_ENV = { ...ENABLED_ENV, OM_AGENT_OTEL_EXPORT_CONTENT: 'allow' }

describe('processOtelExportJob content lock matrix', () => {
  const payload: OtelExportJobPayload = { runId: RUN_ID, attempt: 0 }
  const cases: Array<{ name: string; env: Record<string, string>; content: string; level: string | null; exported: boolean }> = [
    { name: 'deployment denies content', env: ENABLED_ENV, content: 'full', level: 'full', exported: false },
    { name: 'tenant chose no content', env: CONTENT_ENV, content: 'none', level: 'full', exported: false },
    { name: 'run captured metadata only', env: CONTENT_ENV, content: 'full', level: 'metadata', exported: false },
    { name: 'run without a capture manifest', env: CONTENT_ENV, content: 'full', level: null, exported: false },
    { name: 'all three locks open', env: CONTENT_ENV, content: 'full', level: 'full', exported: true },
  ]

  test.each(cases)('$name', async ({ env, content, level, exported }) => {
    const harness = makeJobDeps({ env, settings: { enabled: true, content }, bundle: capturedBundle(level) })
    const loadContent = jest.fn(async (_bundle: RunExportBundle, _mode: OtelContentExportMode) =>
      llmContent([LLM_SPAN_ID], CONTENT_SENTINEL),
    )
    expect(await processOtelExportJob(payload, { ...harness.deps, loadContent })).toBe('exported')
    const body = harness.post.mock.calls.map(([input]) => input.body).join('\n')
    if (exported) {
      expect(loadContent).toHaveBeenCalledWith(expect.objectContaining({ run: expect.objectContaining({ id: RUN_ID }) }), 'full')
      expect(body).toContain(INFERENCE_EVENT)
      expect(body).toContain(CONTENT_SENTINEL)
      expect(body).toContain('om.content.export_status')
    } else {
      expect(loadContent).not.toHaveBeenCalled()
      expect(body).not.toContain(INFERENCE_EVENT)
      expect(body).not.toContain(CONTENT_SENTINEL)
      expect(body).not.toContain('om.content.export_status')
    }
  })

  test('re-resolves the mode per job, so a tenant that turns content off stops the next job', async () => {
    const harness = makeJobDeps({
      env: CONTENT_ENV,
      settings: [{ enabled: true, content: 'full' }, { enabled: true, content: 'none' }],
      bundle: capturedBundle('full'),
    })
    const loadContent = jest.fn(async () => llmContent([LLM_SPAN_ID], CONTENT_SENTINEL))
    await processOtelExportJob(payload, { ...harness.deps, loadContent })
    await processOtelExportJob(payload, { ...harness.deps, loadContent })
    expect(loadContent).toHaveBeenCalledTimes(1)
    expect(harness.post.mock.calls[0][0].body).toContain(CONTENT_SENTINEL)
    expect(harness.post.mock.calls[1][0].body).not.toContain(CONTENT_SENTINEL)
  })

  test('loads content through loadRunExportContent with the job container and the full mode by default', async () => {
    const harness = makeJobDeps({ env: CONTENT_ENV, settings: { enabled: true, content: 'full' }, bundle: capturedBundle('full') })
    loadRunExportContent.mockResolvedValue(llmContent([LLM_SPAN_ID], CONTENT_SENTINEL))
    expect(await processOtelExportJob(payload, harness.deps)).toBe('exported')
    expect(loadRunExportContent).toHaveBeenCalledWith(harness.deps.container, expect.objectContaining({ run: expect.anything() }), { mode: 'full' })
    expect(harness.post.mock.calls[0][0].body).toContain(INFERENCE_EVENT)
  })

  test('splits a content-heavy run into requests of at most 4 MiB uncompressed', async () => {
    const spanIds = Array.from({ length: 30 }, (_unused, index) => `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`)
    const spans = spanIds.map((id, index) => llmSpan(id, index + 1))
    const harness = makeJobDeps({ env: CONTENT_ENV, settings: { enabled: true, content: 'full' }, bundle: capturedBundle('full', spans) })
    const text = 'lorem ipsum dolor '.repeat(3500)
    const loadContent = jest.fn(async () => llmContent(spanIds, text))
    expect(await processOtelExportJob(payload, { ...harness.deps, loadContent })).toBe('exported')
    expect(harness.post.mock.calls.length).toBeGreaterThan(1)
    let spanCount = 0
    for (const [input] of harness.post.mock.calls) {
      expect(Buffer.byteLength(input.body, 'utf8')).toBeLessThanOrEqual(OTEL_EXPORT_MAX_REQUEST_BYTES)
      const request = JSON.parse(input.body) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: unknown[] }> }> }
      spanCount += request.resourceSpans[0].scopeSpans[0].spans.length
    }
    expect(spanCount).toBe(spans.length + 1)
  })
})

describe('encodeOtlpRequestBodies', () => {
  test('halves a chunk over the byte limit and keeps a single oversized span in its own request', () => {
    const spans = Array.from({ length: 4 }, (_unused, index) => ({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: `00f067aa0ba902b${index}`,
      name: `span-${index}`,
      kind: 'internal' as const,
      startTime: T0,
      endTime: T0,
      attributes: { 'om.note': 'x'.repeat(index === 3 ? 900 : 100) },
    }))
    const chunk = { resource: { attributes: { 'service.name': 'svc' } }, scopeSpans: [{ scope: { name: 'scope' }, spans }] }
    expect(encodeOtlpRequestBodies([chunk], 1_000_000)).toHaveLength(1)
    const bodies = encodeOtlpRequestBodies([chunk], 800)
    const names = bodies.map((body) => {
      const request = JSON.parse(body) as { resourceSpans: Array<{ resource: unknown; scopeSpans: Array<{ spans: Array<{ name: string }> }> }> }
      expect(request.resourceSpans[0].resource).toEqual({ attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] })
      return request.resourceSpans[0].scopeSpans[0].spans.map((span) => span.name)
    })
    expect(names.flat()).toEqual(['span-0', 'span-1', 'span-2', 'span-3'])
    expect(names[names.length - 1]).toEqual(['span-3'])
    for (const body of bodies.slice(0, -1)) expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(800)
  })
})

