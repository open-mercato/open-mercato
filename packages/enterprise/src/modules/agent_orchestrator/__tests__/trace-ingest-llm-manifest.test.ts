import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentSpan } from '../data/entities'
import {
  TRACE_INGEST_LLM_BODY_MAX_BYTES,
  TRACE_INGEST_MANIFEST_KNOWLEDGE_MAX,
  TRACE_INGEST_STOP_SEQUENCES_MAX,
  traceIngestSchema,
} from '../data/validators'
import { ingestTrace, SUMMARY_CHAR_LIMIT, type IngestTraceOptions } from '../lib/trace/traceIngestionService'
import { fitIngestLlmAttributes } from '../lib/trace/ingestLlmAttributes'
import { ingestPayloadNeedsCapture, resolveIngestContentCapture } from '../lib/trace/ingestContentCapture'
import { AGENT_TRACE_CONTENT_NAMESPACE } from '../lib/trace/artifactStore'
import { GEN_AI_ATTRIBUTES, LEGACY_LLM_ATTRIBUTES, OM_LLM_ATTRIBUTES } from '../lib/trace/genAiAttributes'
import { LLM_REQUEST_ARTIFACT_SCHEMA } from '../lib/trace/contentCapture'
import type { RunManifestCapture } from '../lib/trace/runManifest'
import type { NativeModelCallContent } from '../lib/runtime/nativeModelCallRecorder'

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity) as Array<Record<string, unknown>>
  }
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value)
  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      return { ...data, __entity: entity }
    },
    persist(row: Record<string, unknown>) {
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
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const HASH = `sha256:${'ab'.repeat(32)}`

const FULL_CAPTURE: RunManifestCapture = { level: 'full', source: 'tenant', retentionDays: 14, redactPii: true }
const METADATA_CAPTURE: RunManifestCapture = { level: 'metadata', source: 'tenant', retentionDays: 30, redactPii: false }

function llmBlock() {
  return {
    provider: 'openai',
    requestModel: 'gpt-5-mini',
    responseModel: 'gpt-5-mini-2026',
    params: { temperature: 0.2, maxTokens: 512, stopSequences: ['END'] },
    usage: { inputTokens: 120, outputTokens: 40, cachedInputTokens: 10 },
    request: {
      system: 'You are a helpful agent.',
      messages: [{ role: 'user', content: 'Write to jane.doe@example.com' }],
    },
    response: { finishReason: 'stop', content: [{ type: 'text', text: 'Done.' }] },
  }
}

function payloadWith(spanExtras: Record<string, unknown> = {}, envelopeExtras: Record<string, unknown> = {}) {
  return {
    runtime: 'external-adapter',
    externalRunId: 'ext-run-1',
    agentId: 'support.triage',
    status: 'ok' as const,
    spans: [
      {
        externalSpanId: 'llm-1',
        sequence: 3,
        name: 'llm:gpt-5-mini',
        kind: 'llm' as const,
        startedAt: '2026-10-28T10:00:01.000Z',
        ...spanExtras,
      },
      {
        externalSpanId: 'root',
        sequence: 0,
        name: 'root',
        kind: 'system' as const,
        startedAt: '2026-10-28T10:00:00.000Z',
      },
    ],
    ...envelopeExtras,
  }
}

function spanAttributes(storeFor: (entity: unknown) => Array<Record<string, unknown>>, externalSpanId: string) {
  const span = storeFor(AgentSpan).find((row) => row.externalSpanId === externalSpanId)
  return span?.attributes as Record<string, unknown> | undefined
}

function stripEntity(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__entity')))
}

function storedOutcome(requestKey: string, responseKey: string) {
  return { status: 'stored' as const, requestKey, responseKey, redactions: [{ rule: 'email', count: 1 }] }
}

describe('trace ingest — legacy payloads', () => {
  it('stores spans byte-identically whether or not capture options are supplied', async () => {
    const legacy = payloadWith({ attributes: { inputTokens: 3, outputTokens: 1, finishReason: 'stop' } })
    const plain = createFakeEm()
    await ingestTrace(plain.em, SCOPE, legacy)
    const offloadLlmContent = jest.fn()
    const withOptions = createFakeEm()
    await ingestTrace(withOptions.em, SCOPE, legacy, { capture: FULL_CAPTURE, offloadLlmContent })

    expect(offloadLlmContent).not.toHaveBeenCalled()
    expect(stripEntity(withOptions.storeFor(AgentSpan))).toEqual(stripEntity(plain.storeFor(AgentSpan)))
    expect(spanAttributes(plain.storeFor, 'llm-1')).toEqual({ inputTokens: 3, outputTokens: 1, finishReason: 'stop' })
    expect(plain.storeFor(AgentSpan)).toHaveLength(2)
  })

  it('does not read the capture policy for payloads without llm or manifest fields', async () => {
    const resolve = jest.fn(() => {
      throw new Error('[internal] unexpected resolve')
    })
    const container = { resolve } as unknown as AwilixContainer
    const legacy = traceIngestSchema.parse(payloadWith())

    expect(ingestPayloadNeedsCapture(legacy)).toBe(false)
    await expect(resolveIngestContentCapture(container, SCOPE, legacy)).resolves.toEqual({})
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('trace ingest — llm field mapping', () => {
  it('maps llm metadata to gen_ai/om keys and drops the bodies below full', async () => {
    const { em, storeFor } = createFakeEm()
    const offloadLlmContent = jest.fn()
    await ingestTrace(em, SCOPE, payloadWith({ llm: llmBlock() }), { capture: METADATA_CAPTURE, offloadLlmContent })

    const attributes = spanAttributes(storeFor, 'llm-1') ?? {}
    expect(offloadLlmContent).not.toHaveBeenCalled()
    expect(attributes).toMatchObject({
      [GEN_AI_ATTRIBUTES.operationName]: 'chat',
      [GEN_AI_ATTRIBUTES.providerName]: 'openai',
      [GEN_AI_ATTRIBUTES.requestModel]: 'gpt-5-mini',
      [GEN_AI_ATTRIBUTES.responseModel]: 'gpt-5-mini-2026',
      [GEN_AI_ATTRIBUTES.requestTemperature]: 0.2,
      [GEN_AI_ATTRIBUTES.requestMaxTokens]: 512,
      [GEN_AI_ATTRIBUTES.requestStopSequences]: ['END'],
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 120,
      [GEN_AI_ATTRIBUTES.usageOutputTokens]: 40,
      [GEN_AI_ATTRIBUTES.usageCacheReadInputTokens]: 10,
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop'],
      [LEGACY_LLM_ATTRIBUTES.inputTokens]: 120,
      [LEGACY_LLM_ATTRIBUTES.outputTokens]: 40,
      [LEGACY_LLM_ATTRIBUTES.finishReason]: 'stop',
      [OM_LLM_ATTRIBUTES.captureFidelity]: 'reported',
      [OM_LLM_ATTRIBUTES.contentStatus]: 'disabled',
    })
    expect(attributes[OM_LLM_ATTRIBUTES.costPricingSource]).toBeDefined()
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestSha256]).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestBytes]).toBeGreaterThan(0)
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toBeUndefined()
    expect(JSON.stringify(attributes)).not.toContain('jane.doe@example.com')
    expect(JSON.stringify(attributes)).not.toContain('You are a helpful agent.')
  })

  it('drops the bodies when no capture was resolved', async () => {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(em, SCOPE, payloadWith({ llm: llmBlock() }))

    const attributes = spanAttributes(storeFor, 'llm-1') ?? {}
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('disabled')
    expect(JSON.stringify(attributes)).not.toContain('jane.doe@example.com')
  })

  it('lets explicit attributes win over llm metadata but never over server-owned content keys', async () => {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(
      em,
      SCOPE,
      payloadWith({
        llm: llmBlock(),
        attributes: {
          [GEN_AI_ATTRIBUTES.providerName]: 'azure-openai',
          [OM_LLM_ATTRIBUTES.contentRequestKey]: 'agent-trace-content/forged',
          [OM_LLM_ATTRIBUTES.contentStatus]: 'stored',
          custom: 'kept',
        },
      }),
      { capture: METADATA_CAPTURE },
    )

    const attributes = spanAttributes(storeFor, 'llm-1') ?? {}
    expect(attributes[GEN_AI_ATTRIBUTES.providerName]).toBe('azure-openai')
    expect(attributes.custom).toBe('kept')
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toBeUndefined()
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('disabled')
  })

  it('ignores an llm block on a non-llm span', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = payloadWith()
    const toolSpan = { ...payload.spans[1], externalSpanId: 'tool-1', kind: 'tool' as const, llm: llmBlock() }
    await ingestTrace(em, SCOPE, { ...payload, spans: [...payload.spans, toolSpan] }, { capture: FULL_CAPTURE })

    expect(spanAttributes(storeFor, 'tool-1')).toBeNull()
  })

  it('strips server-owned content keys from spans ingested without an llm block', async () => {
    const { em, storeFor } = createFakeEm()
    const forged = {
      [GEN_AI_ATTRIBUTES.providerName]: 'openai',
      [OM_LLM_ATTRIBUTES.contentRequestKey]: 'agent-trace-content/org-1/forged-request.json',
      [OM_LLM_ATTRIBUTES.contentResponseKey]: 'attachments/org-1/someone-else.pdf',
      [OM_LLM_ATTRIBUTES.contentStatus]: 'stored',
      custom: 'kept',
    }
    const payload = payloadWith({ attributes: forged })
    const toolSpan = { ...payload.spans[1], externalSpanId: 'tool-forged', kind: 'tool' as const, attributes: forged }
    await ingestTrace(em, SCOPE, { ...payload, spans: [...payload.spans, toolSpan] }, { capture: FULL_CAPTURE })

    for (const spanId of ['llm-1', 'tool-forged']) {
      const attributes = spanAttributes(storeFor, spanId) ?? {}
      expect(attributes.custom).toBe('kept')
      expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toBeUndefined()
      expect(attributes[OM_LLM_ATTRIBUTES.contentResponseKey]).toBeUndefined()
      expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBeUndefined()
    }
  })

  it('keeps content keys stamped by the trusted native capture', async () => {
    const { em, storeFor } = createFakeEm()
    const requestKey = `${AGENT_TRACE_CONTENT_NAMESPACE}/org-1/1_native_llm-request.json`
    await ingestTrace(
      em,
      SCOPE,
      payloadWith({ attributes: { [OM_LLM_ATTRIBUTES.contentRequestKey]: requestKey } }),
      { trustSpanContentKeys: true },
    )

    expect(spanAttributes(storeFor, 'llm-1')?.[OM_LLM_ATTRIBUTES.contentRequestKey]).toBe(requestKey)
  })
})

describe('trace ingest — llm content at full', () => {
  it('offloads the bodies of fresh spans once and writes the content keys', async () => {
    const { em, storeFor } = createFakeEm()
    const offloadLlmContent = jest.fn(async (contents: NativeModelCallContent[]) =>
      contents.map((_content, index) => storedOutcome(`agent-trace-content/req-${index}`, `agent-trace-content/res-${index}`)),
    )
    const options: IngestTraceOptions = { capture: FULL_CAPTURE, offloadLlmContent }
    await ingestTrace(em, SCOPE, payloadWith({ llm: llmBlock() }), options)
    await ingestTrace(em, SCOPE, payloadWith({ llm: llmBlock() }), options)

    expect(offloadLlmContent).toHaveBeenCalledTimes(1)
    const [contents] = offloadLlmContent.mock.calls[0]
    expect(contents).toHaveLength(1)
    expect(contents[0].request).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-5-mini',
      system: 'You are a helpful agent.',
      callSettings: { temperature: 0.2, maxOutputTokens: 512, stopSequences: ['END'] },
    })
    expect(contents[0].response).toMatchObject({ finishReason: 'stop', content: [{ type: 'text', text: 'Done.' }] })

    const attributes = spanAttributes(storeFor, 'llm-1') ?? {}
    expect(attributes).toMatchObject({
      [OM_LLM_ATTRIBUTES.contentRequestKey]: 'agent-trace-content/req-0',
      [OM_LLM_ATTRIBUTES.contentResponseKey]: 'agent-trace-content/res-0',
      [OM_LLM_ATTRIBUTES.contentStatus]: 'stored',
      [OM_LLM_ATTRIBUTES.contentRedactions]: [{ rule: 'email', count: 1 }],
    })
    expect(JSON.stringify(attributes)).not.toContain('jane.doe@example.com')
  })

  it('records storage_unavailable and still ingests when the offload throws or is absent', async () => {
    const failing = createFakeEm()
    const offloadLlmContent = jest.fn(async () => {
      throw new Error('[internal] storage down')
    })
    const result = await ingestTrace(failing.em, SCOPE, payloadWith({ llm: llmBlock() }), {
      capture: FULL_CAPTURE,
      offloadLlmContent,
    })
    expect(result.spansAppended).toBe(2)
    expect(spanAttributes(failing.storeFor, 'llm-1')?.[OM_LLM_ATTRIBUTES.contentStatus]).toBe('storage_unavailable')

    const absent = createFakeEm()
    await ingestTrace(absent.em, SCOPE, payloadWith({ llm: llmBlock() }), { capture: FULL_CAPTURE })
    expect(spanAttributes(absent.storeFor, 'llm-1')?.[OM_LLM_ATTRIBUTES.contentStatus]).toBe('storage_unavailable')
  })

  it('writes no content status at full when the adapter sent no bodies', async () => {
    const { em, storeFor } = createFakeEm()
    const { request: _request, response: _response, ...metadataOnly } = llmBlock()
    const offloadLlmContent = jest.fn()
    await ingestTrace(em, SCOPE, payloadWith({ llm: metadataOnly }), { capture: FULL_CAPTURE, offloadLlmContent })

    expect(offloadLlmContent).not.toHaveBeenCalled()
    expect(spanAttributes(storeFor, 'llm-1')?.[OM_LLM_ATTRIBUTES.contentStatus]).toBeUndefined()
  })

  it('uploads redacted artifacts to the content namespace through the resolved tenant policy', async () => {
    type UploadInput = { namespace: string; fileName: string; buffer: Buffer }
    let uploadSequence = 0
    const upload = jest.fn(async (input: UploadInput) => ({
      key: `${input.namespace}/${++uploadSequence}-${input.fileName}`,
    }))
    const getRecord = jest.fn(async () => ({ value: { level: 'full', redactPii: true }, source: 'tenant' }))
    const registry: Record<string, unknown> = {
      moduleConfigService: { getRecord },
      storageService: { _resolveService: async () => ({ upload, download: jest.fn(), delete: jest.fn() }) },
      em: { fork: () => ({}) },
    }
    const container = {
      resolve: (name: string) => {
        if (!(name in registry)) throw new Error(`[internal] unexpected resolve("${name}")`)
        return registry[name]
      },
    } as unknown as AwilixContainer
    const payload = traceIngestSchema.parse(payloadWith({ llm: llmBlock() }))

    const captureOptions = await resolveIngestContentCapture(container, SCOPE, payload)
    expect(captureOptions.capture?.level).toBe('full')
    const { em, storeFor } = createFakeEm()
    await ingestTrace(em, SCOPE, payload, captureOptions)

    expect(upload).toHaveBeenCalledTimes(2)
    const uploads = upload.mock.calls.map(([input]) => input)
    expect(uploads.every((input) => input.namespace === AGENT_TRACE_CONTENT_NAMESPACE)).toBe(true)
    const bodies = uploads.map((input) => {
      const wrapper = JSON.parse(input.buffer.toString('utf8')) as Record<string, string>
      return JSON.parse(wrapper.input ?? wrapper.output) as Record<string, unknown>
    })
    expect(bodies.map((body) => body.schema)).toContain(LLM_REQUEST_ARTIFACT_SCHEMA)
    expect(JSON.stringify(bodies)).not.toContain('jane.doe@example.com')
    const attributes = spanAttributes(storeFor, 'llm-1') ?? {}
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('stored')
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toMatch(/^agent-trace-content\//)
  })

  it('resolves a metadata policy without wiring an offloader', async () => {
    const getRecord = jest.fn(async () => ({ value: { level: 'metadata' }, source: 'tenant' }))
    const container = {
      resolve: (name: string) => {
        if (name === 'moduleConfigService') return { getRecord }
        throw new Error(`[internal] unexpected resolve("${name}")`)
      },
    } as unknown as AwilixContainer
    const payload = traceIngestSchema.parse(payloadWith({ llm: llmBlock() }))

    const captureOptions = await resolveIngestContentCapture(container, SCOPE, payload)
    expect(captureOptions.capture?.level).toBe('metadata')
    expect(captureOptions.offloadLlmContent).toBeUndefined()
  })
})

describe('trace ingest — manifest', () => {
  it('appends one run.manifest system span with the integration invoker and the resolved capture', async () => {
    const { em, storeFor } = createFakeEm()
    const manifest = {
      definitionHash: HASH,
      toolNames: ['search.query', 'customers.get'],
      modelDeclared: 'gpt-5-mini',
      knowledge: { 'rules.rule_set': '2026-10-20.3' },
    }
    const first = await ingestTrace(em, SCOPE, payloadWith({}, { manifest }), { capture: FULL_CAPTURE })
    await ingestTrace(em, SCOPE, payloadWith({}, { manifest }), { capture: FULL_CAPTURE })

    const manifestSpans = storeFor(AgentSpan).filter((row) => row.name === 'run.manifest')
    expect(manifestSpans).toHaveLength(1)
    const [span] = manifestSpans
    expect(span).toMatchObject({
      kind: 'system',
      externalSpanId: `${first.runId}:manifest`,
      sequence: 4,
      startedAt: new Date('2026-10-28T10:00:00.000Z'),
    })
    const attributes = span.attributes as Record<string, unknown>
    expect(attributes).toMatchObject({
      'om.runtime': 'external',
      'om.agent.id': 'support.triage',
      'om.agent.definition_hash': HASH,
      'om.tools.names': ['customers.get', 'search.query'],
      'om.model.declared': 'gpt-5-mini',
      'om.knowledge': { 'rules.rule_set': '2026-10-20.3' },
      'om.invoker': { kind: 'integration', userId: null, apiKeyId: null, ownerUserId: null },
      'om.capture': FULL_CAPTURE,
    })
    expect(attributes['om.agent.source']).toBeUndefined()
  })

  it('omits facts the adapter did not report and om.capture when no capture was resolved', async () => {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(em, SCOPE, payloadWith({}, { manifest: { agentSource: 'file' } }))

    const span = storeFor(AgentSpan).find((row) => row.name === 'run.manifest')
    const attributes = span?.attributes as Record<string, unknown>
    expect(attributes['om.agent.source']).toBe('file')
    expect(attributes['om.agent.definition_hash']).toBeUndefined()
    expect(attributes['om.capture']).toBeUndefined()
  })

  it('marks a manifest-only payload as needing the capture policy', () => {
    expect(ingestPayloadNeedsCapture(traceIngestSchema.parse(payloadWith({}, { manifest: {} })))).toBe(true)
    expect(ingestPayloadNeedsCapture(traceIngestSchema.parse(payloadWith({ llm: {} })))).toBe(true)
  })
})

describe('trace ingest — size bounds', () => {
  it('rejects request bodies over the ingest byte limit', () => {
    const oversized = 'x'.repeat(TRACE_INGEST_LLM_BODY_MAX_BYTES + 1)
    const result = traceIngestSchema.safeParse(
      payloadWith({ llm: { request: { messages: [{ role: 'user', content: oversized }] } } }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects absurd list sizes and accepts normal payloads', () => {
    const stopSequences = Array.from({ length: TRACE_INGEST_STOP_SEQUENCES_MAX + 1 }, (_value, index) => `s${index}`)
    expect(traceIngestSchema.safeParse(payloadWith({ llm: { params: { stopSequences } } })).success).toBe(false)
    const knowledge = Object.fromEntries(
      Array.from({ length: TRACE_INGEST_MANIFEST_KNOWLEDGE_MAX + 1 }, (_value, index) => [`rules.set_${index}`, 'v1']),
    )
    expect(traceIngestSchema.safeParse(payloadWith({}, { manifest: { knowledge } })).success).toBe(false)
    expect(traceIngestSchema.safeParse(payloadWith({}, { manifest: { definitionHash: 'not-a-hash' } })).success).toBe(false)
    expect(traceIngestSchema.safeParse(payloadWith({ llm: llmBlock() }, { manifest: { definitionHash: HASH } })).success).toBe(true)
  })

  it('keeps the content references when llm attributes exceed the inline cap', () => {
    const attributes = {
      [LEGACY_LLM_ATTRIBUTES.inputTokens]: 1,
      [OM_LLM_ATTRIBUTES.contentRequestKey]: 'agent-trace-content/req',
      [OM_LLM_ATTRIBUTES.contentResponseKey]: 'agent-trace-content/res',
      [OM_LLM_ATTRIBUTES.contentStatus]: 'stored',
      [OM_LLM_ATTRIBUTES.contentRedactions]: [{ rule: 'email', count: 1 }],
      bulky: 'y'.repeat(SUMMARY_CHAR_LIMIT),
    }
    expect(fitIngestLlmAttributes(attributes, SUMMARY_CHAR_LIMIT)).toEqual({
      [LEGACY_LLM_ATTRIBUTES.inputTokens]: 1,
      [OM_LLM_ATTRIBUTES.contentRequestKey]: 'agent-trace-content/req',
      [OM_LLM_ATTRIBUTES.contentResponseKey]: 'agent-trace-content/res',
      [OM_LLM_ATTRIBUTES.contentStatus]: 'stored',
    })
  })
})
