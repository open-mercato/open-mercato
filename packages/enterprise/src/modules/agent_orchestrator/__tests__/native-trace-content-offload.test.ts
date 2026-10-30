const ingestTraceMock = jest.fn<Promise<{ runId: string }>, unknown[]>()
jest.mock('../lib/trace/traceIngestionService', () => {
  const actual = jest.requireActual('../lib/trace/traceIngestionService')
  return { ...actual, ingestTrace: (...args: unknown[]) => ingestTraceMock(...args) }
})
jest.mock('../lib/eval/evalRuntimeService', () => ({ evaluateRun: jest.fn(async () => undefined) }))
jest.mock('../lib/crudCache', () => ({ invalidateAgentRunCache: jest.fn(async () => undefined) }))

import type { TraceIngest } from '../data/validators'
import {
  buildNativeTracePayload,
  captureNativeRunTrace,
  offloadNativeTraceContent,
  type NativeTraceInput,
} from '../lib/runtime/nativeTraceCapture'
import { CONTENT_UPLOAD_CONCURRENCY, offloadModelCallContent } from '../lib/runtime/nativeContentOffload'
import type { NativeModelCallRecord } from '../lib/runtime/nativeModelCallRecorder'
import { AGENT_TRACE_CONTENT_NAMESPACE, ARTIFACT_REFS } from '../lib/trace/artifactStore'
import { LLM_REQUEST_ARTIFACT_SCHEMA, LLM_RESPONSE_ARTIFACT_SCHEMA } from '../lib/trace/contentCapture'
import { OM_LLM_ATTRIBUTES } from '../lib/trace/genAiAttributes'
import { computeManifestSha256 } from '../lib/trace/runManifest'

const RUN_ID = '018f6f2a-0000-4000-8000-0000000000c1'
const T0 = Date.parse('2026-10-28T10:00:00.000Z')
const SCOPE = { tenantId: 't1', organizationId: 'o1' }

type UploadInput = { namespace: string; fileName: string; buffer: Buffer; scope: unknown }

function buildCall(callId: string, stepNumber: number, withContent = true): NativeModelCallRecord {
  return {
    callId,
    stepNumber,
    provider: 'openai',
    requestModel: 'gpt-5-mini',
    responseModel: 'gpt-5-mini',
    responseId: `resp-${callId}`,
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5 },
    callSettings: { temperature: 0.1 },
    hasProviderOptions: false,
    latencyMs: 20,
    startedAtMs: T0,
    endedAtMs: T0 + 20,
    fidelity: 'exact',
    requestSha256: computeManifestSha256(`request-${callId}`),
    requestBytes: 100,
    responseSha256: computeManifestSha256(`response-${callId}`),
    responseBytes: 50,
    systemSha256: null,
    toolsSha256: null,
    toolCount: 0,
    messageCount: 1,
    ...(withContent
      ? {
          content: {
            request: {
              provider: 'openai',
              modelId: 'gpt-5-mini',
              system: 'You are a helpful agent.',
              messages: [{ role: 'user', content: 'Contact jane.doe@example.com about the order.' }],
              tools: undefined,
              responseFormat: undefined,
              callSettings: { temperature: 0.1 },
            },
            response: {
              finishReason: 'stop',
              content: [{ type: 'text', text: 'Done.' }],
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          },
        }
      : {}),
  }
}

function traceInput(calls: NativeModelCallRecord[], overrides: Partial<NativeTraceInput> = {}): NativeTraceInput {
  return {
    runId: RUN_ID,
    agentId: 'content.agent',
    steps: calls.map((call, index) => ({
      modelId: 'gpt-5-mini',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [],
      endedAtMs: T0 + 100 * (index + 1),
      call,
    })),
    startedAtMs: T0,
    endedAtMs: T0 + 1000,
    captureLevel: 'full',
    ...overrides,
  }
}

type TestContainer = { resolve<T = unknown>(name: string): T }

function containerOf(registry: Record<string, unknown>): TestContainer {
  return {
    resolve<T = unknown>(name: string): T {
      if (!(name in registry)) throw new Error(`[internal] unexpected resolve("${name}")`)
      return registry[name] as T
    },
  }
}

function storageContainer(upload: (input: UploadInput) => Promise<{ key: string }>) {
  const service = {
    upload: jest.fn(upload),
    download: jest.fn(),
    delete: jest.fn(),
  }
  const container = containerOf({
    storageService: { _resolveService: async () => service },
    em: { fork: () => ({}) },
  })
  return { container, service }
}

function sequentialKeys() {
  let sequence = 0
  return async (input: UploadInput) => ({ key: `${input.namespace}/${++sequence}-${input.fileName}` })
}

function llmAttributes(payload: TraceIngest, index = 0): Record<string, unknown> {
  const spans = (payload.spans ?? []).filter((span) => span.kind === 'llm')
  return spans[index].attributes as Record<string, unknown>
}

function uploadedBody(input: UploadInput): Record<string, unknown> {
  const wrapper = JSON.parse(input.buffer.toString('utf8')) as Record<string, string>
  const serialized = wrapper.input ?? wrapper.output
  return JSON.parse(serialized) as Record<string, unknown>
}

afterEach(() => {
  delete process.env.OM_AGENT_TRACE_CONTENT_MAX_BYTES
  jest.clearAllMocks()
})

describe('offloadNativeTraceContent', () => {
  it('uploads the request and response of each call at full and writes the keys on the span', async () => {
    const { container, service } = storageContainer(sequentialKeys())
    const input = traceInput([buildCall('call-1', 0)], { redactPii: true })

    const prepared = await offloadNativeTraceContent(container, SCOPE, input)

    expect(service.upload).toHaveBeenCalledTimes(2)
    const uploads = service.upload.mock.calls.map(([upload]) => upload as UploadInput)
    expect(uploads.every((upload) => upload.namespace === AGENT_TRACE_CONTENT_NAMESPACE)).toBe(true)
    const bodies = uploads.map(uploadedBody)
    expect(bodies.map((body) => body.schema).sort()).toEqual(
      [LLM_REQUEST_ARTIFACT_SCHEMA, LLM_RESPONSE_ARTIFACT_SCHEMA].sort(),
    )
    expect(JSON.stringify(bodies)).not.toContain('jane.doe@example.com')

    const call = prepared.steps[0].call
    expect(call?.content).toBeUndefined()
    expect(call?.contentOutcome).toMatchObject({ status: 'stored', redactions: [{ rule: 'email', count: 1 }] })

    const attributes = llmAttributes(buildNativeTracePayload(prepared))
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('stored')
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toMatch(/^agent-trace-content\//)
    expect(attributes[OM_LLM_ATTRIBUTES.contentResponseKey]).toMatch(/^agent-trace-content\//)
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).not.toBe(attributes[OM_LLM_ATTRIBUTES.contentResponseKey])
    expect(attributes[OM_LLM_ATTRIBUTES.contentRedactions]).toEqual([{ rule: 'email', count: 1 }])
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestSha256]).toBe(computeManifestSha256('request-call-1'))
    expect(JSON.stringify(prepared)).not.toContain('jane.doe@example.com')
  })

  it('keeps personal data in the artifact when redactPii is off, but still masks secrets', async () => {
    const { container, service } = storageContainer(sequentialKeys())
    const call = buildCall('call-1', 0)
    call.content?.request.messages.push({ role: 'user', content: 'Authorization: Bearer abcdefghijklmnop' })

    const prepared = await offloadNativeTraceContent(container, SCOPE, traceInput([call]))

    const bodies = service.upload.mock.calls.map(([upload]) => uploadedBody(upload as UploadInput))
    const serialized = JSON.stringify(bodies)
    expect(serialized).toContain('jane.doe@example.com')
    expect(serialized).not.toContain('abcdefghijklmnop')
    expect(prepared.steps[0].call?.contentOutcome?.redactions.map((entry) => entry.rule)).not.toContain('email')
  })

  it('stores nothing below full, strips the content and keeps the status disabled', async () => {
    const { container, service } = storageContainer(sequentialKeys())

    const prepared = await offloadNativeTraceContent(
      container,
      SCOPE,
      traceInput([buildCall('call-1', 0)], { captureLevel: 'metadata' }),
    )

    expect(service.upload).not.toHaveBeenCalled()
    expect(prepared.steps[0].call?.content).toBeUndefined()
    expect(prepared.steps[0].call?.contentOutcome).toBeUndefined()
    const attributes = llmAttributes(buildNativeTracePayload(prepared))
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('disabled')
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toBeUndefined()
  })

  it('records storage_unavailable when an upload fails', async () => {
    let sequence = 0
    const { container } = storageContainer(async (input) => {
      sequence += 1
      if (sequence === 2) throw new Error('[internal] storage down')
      return { key: `${input.namespace}/${sequence}` }
    })

    const prepared = await offloadNativeTraceContent(container, SCOPE, traceInput([buildCall('call-1', 0)]))

    expect(prepared.steps[0].call?.contentOutcome?.status).toBe('storage_unavailable')
    const attributes = llmAttributes(buildNativeTracePayload(prepared))
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('storage_unavailable')
  })

  it('records storage_unavailable when the tenant has no storage', async () => {
    const container = {
      resolve: () => {
        throw new Error('[internal] not registered')
      },
    }

    const prepared = await offloadNativeTraceContent(
      container,
      SCOPE,
      traceInput([], { steps: [], fallbackCall: buildCall('call-1', 0) }),
    )

    expect(prepared.fallbackCall?.content).toBeUndefined()
    expect(prepared.fallbackCall?.contentOutcome).toEqual({
      status: 'storage_unavailable',
      requestKey: null,
      responseKey: null,
      redactions: [],
    })
    const attributes = llmAttributes(buildNativeTracePayload(prepared))
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('storage_unavailable')
  })

  it('records over_cap_truncated when an artifact exceeds the byte cap', async () => {
    process.env.OM_AGENT_TRACE_CONTENT_MAX_BYTES = '400'
    const { container } = storageContainer(sequentialKeys())
    const call = buildCall('call-1', 0)
    call.content?.request.messages.push({ role: 'user', content: 'long '.repeat(400) })

    const prepared = await offloadNativeTraceContent(container, SCOPE, traceInput([call]))

    const attributes = llmAttributes(buildNativeTracePayload(prepared))
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('over_cap_truncated')
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toEqual(expect.any(String))
  })
})

describe('offloadModelCallContent', () => {
  it('keeps at most four uploads in flight', async () => {
    let inFlight = 0
    let peak = 0
    const { container, service } = storageContainer(async (input) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setImmediate(resolve))
      inFlight -= 1
      return { key: `${input.namespace}/${input.fileName}-${service.upload.mock.calls.length}` }
    })
    const calls = Array.from({ length: 5 }, (_, index) => buildCall(`call-${index}`, index))

    const result = await offloadModelCallContent(container, SCOPE, calls, { redactPii: false })

    expect(service.upload).toHaveBeenCalledTimes(10)
    expect(peak).toBeLessThanOrEqual(CONTENT_UPLOAD_CONCURRENCY)
    expect(result.map((call) => call.contentOutcome?.status)).toEqual(Array(5).fill('stored'))
    expect(result.every((call) => call.content === undefined)).toBe(true)
  })

  it('uses the request and response encryption refs and leaves calls without content untouched', async () => {
    const encrypted: Array<{ entityId: string; field: string }> = []
    const { service } = storageContainer(sequentialKeys())
    const container = containerOf({
      storageService: { _resolveService: async () => service },
      tenantEncryptionService: {
        encryptEntityPayload: async (entityId: string, payload: Record<string, unknown>) => {
          encrypted.push({ entityId, field: Object.keys(payload)[0] })
          return payload
        },
        decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
      },
    })
    const bare = buildCall('call-2', 1, false)

    const result = await offloadModelCallContent(container, SCOPE, [buildCall('call-1', 0), bare], { redactPii: false })

    expect(encrypted).toEqual(expect.arrayContaining([ARTIFACT_REFS.llmRequest, ARTIFACT_REFS.llmResponse]))
    expect(result[1]).toBe(bare)
  })
})

describe('captureNativeRunTrace with full content capture', () => {
  it('uploads before ingesting and ingests a payload carrying the keys but no content', async () => {
    const order: string[] = []
    const { container } = storageContainer(async (input) => {
      order.push('upload')
      return { key: `${input.namespace}/${order.length}` }
    })
    ingestTraceMock.mockImplementation(async () => {
      order.push('ingest')
      return { runId: RUN_ID }
    })

    await captureNativeRunTrace(container, SCOPE, traceInput([buildCall('call-1', 0)]))

    expect(order).toEqual(['upload', 'upload', 'ingest'])
    const payload = ingestTraceMock.mock.calls[0][2] as TraceIngest
    expect(llmAttributes(payload)[OM_LLM_ATTRIBUTES.contentStatus]).toBe('stored')
    expect(JSON.stringify(payload)).not.toContain('jane.doe@example.com')
  })

  it('still ingests the trace with storage_unavailable when every upload fails', async () => {
    const { container } = storageContainer(async () => {
      throw new Error('[internal] storage down')
    })
    ingestTraceMock.mockResolvedValue({ runId: RUN_ID })

    await expect(
      captureNativeRunTrace(container, SCOPE, traceInput([buildCall('call-1', 0)])),
    ).resolves.toBeUndefined()

    const payload = ingestTraceMock.mock.calls[0][2] as TraceIngest
    expect(llmAttributes(payload)[OM_LLM_ATTRIBUTES.contentStatus]).toBe('storage_unavailable')
    expect(llmAttributes(payload)[OM_LLM_ATTRIBUTES.contentRequestKey]).toBeUndefined()
  })
})
