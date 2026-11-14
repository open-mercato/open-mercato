/** @jest-environment node */
import type { ArtifactReadResult } from '../lib/trace/artifactStore'
import type { RunExportBundle, RunExportSpan } from '../lib/trace/otel/loadRunExportBundle'
import {
  OTEL_CONTENT_ACCESS_KINDS,
  OTEL_CONTENT_READ_CONCURRENCY,
  loadRunExportContent,
} from '../lib/trace/otel/loadRunExportContent'

const mockReadArtifact = jest.fn<Promise<ArtifactReadResult>, [unknown, unknown, unknown, string]>()
const mockRecordAccess = jest.fn<Promise<void>, [unknown, Record<string, unknown>]>()
const mockReadPolicy = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockReportError = jest.fn()

jest.mock('../lib/trace/artifactStore', () => {
  const actual = jest.requireActual('../lib/trace/artifactStore')
  return { ...actual, readArtifact: (...args: [unknown, unknown, unknown, string]) => mockReadArtifact(...args) }
})

jest.mock('../lib/trace/contentArtifactAccess', () => {
  const actual = jest.requireActual('../lib/trace/contentArtifactAccess')
  return {
    ...actual,
    recordTraceContentAccess: (container: unknown, entry: Record<string, unknown>) => mockRecordAccess(container, entry),
  }
})

jest.mock('../lib/trace/capturePolicy', () => ({
  readTraceCapturePolicy: (...args: unknown[]) => mockReadPolicy(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const DAY_MS = 24 * 60 * 60 * 1000

function freshKey(name: string, ageDays = 0): string {
  return `org_${ORG}/agent-trace-content/${Date.now() - ageDays * DAY_MS}_abc_${name}.json`
}

function llmSpan(id: string, attributes: Record<string, unknown> | null): RunExportSpan {
  return {
    id,
    externalSpanId: `ext-${id}`,
    parentSpanId: null,
    sequence: 1,
    name: 'llm',
    kind: 'llm',
    status: 'ok',
    startedAt: new Date(),
    endedAt: new Date(),
    durationMs: 10,
    attributes,
  }
}

function contentKeys(requestKey?: string, responseKey?: string): Record<string, unknown> {
  return {
    ...(requestKey ? { 'om.content.request.key': requestKey } : {}),
    ...(responseKey ? { 'om.content.response.key': responseKey } : {}),
  }
}

function bundleOf(spans: RunExportSpan[]): Pick<RunExportBundle, 'run' | 'spans'> {
  return {
    run: { id: RUN_ID, tenantId: TENANT, organizationId: ORG } as RunExportBundle['run'],
    spans,
  }
}

const container = {
  resolve: <T,>(name: string): T => {
    if (name === 'em') return { fork: () => ({}) } as T
    throw new Error(`[internal] unexpected resolve ${name}`)
  },
}

function storedRows(spans: RunExportSpan[]): void {
  mockFindWithDecryption.mockResolvedValue(
    spans.filter((span) => span.kind === 'llm').map((span) => ({ id: span.id, attributes: span.attributes })),
  )
}

const REQUEST_ARTIFACT = {
  schema: 'om.llm_request.v1',
  system: 'be brief',
  messages: [
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: { q: 'deal' } }],
    },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { ok: true } }] },
  ],
  tools: [],
  params: {},
}

const RESPONSE_ARTIFACT = {
  schema: 'om.llm_response.v1',
  finishReason: 'stop',
  content: [{ type: 'text', text: 'done' }],
  usage: {},
}

beforeEach(() => {
  mockReadArtifact.mockReset()
  mockRecordAccess.mockReset().mockResolvedValue(undefined)
  mockReadPolicy.mockReset().mockResolvedValue({ policy: { retentionDays: 30 }, source: 'tenant', updatedAt: null })
  mockFindWithDecryption.mockReset()
  mockReportError.mockReset()
})

describe('loadRunExportContent', () => {
  it('reads nothing for a metadata-mode run', async () => {
    const spans = [llmSpan('s1', contentKeys(freshKey('req'), freshKey('res')))]
    storedRows(spans)
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'none', retentionDays: 30 })
    expect(result.bySpanId.size).toBe(0)
    expect(result.toolCalls.size).toBe(0)
    expect(mockReadArtifact).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockRecordAccess).not.toHaveBeenCalled()
  })

  it('loads request and response, indexes tool calls and access-logs each read with no actor', async () => {
    const requestKey = freshKey('req')
    const responseKey = freshKey('res')
    const spans = [llmSpan('s1', contentKeys(requestKey, responseKey))]
    storedRows(spans)
    mockReadArtifact.mockImplementation(async (_container, _scope, _ref, key) =>
      key === requestKey ? { status: 'ok', value: REQUEST_ARTIFACT } : { status: 'ok', value: RESPONSE_ARTIFACT },
    )
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'full', retentionDays: 30 })
    expect(result.bySpanId.get('s1')).toEqual({ status: 'exported', request: REQUEST_ARTIFACT, response: RESPONSE_ARTIFACT })
    expect(result.toolCalls.get('call-1')?.arguments?.value).toContain('deal')
    expect(result.toolCalls.get('call-1')?.result).toBeDefined()
    for (const call of mockReadArtifact.mock.calls) {
      expect(call[1]).toEqual({ tenantId: TENANT, organizationId: ORG })
    }
    expect(mockRecordAccess.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([
        {
          tenantId: TENANT,
          organizationId: ORG,
          actorUserId: null,
          apiKeyId: null,
          runId: RUN_ID,
          kind: OTEL_CONTENT_ACCESS_KINDS.llmRequest,
          key: requestKey,
        },
        {
          tenantId: TENANT,
          organizationId: ORG,
          actorUserId: null,
          apiKeyId: null,
          runId: RUN_ID,
          kind: OTEL_CONTENT_ACCESS_KINDS.llmResponse,
          key: responseKey,
        },
      ]),
    )
    expect(mockRecordAccess).toHaveBeenCalledTimes(2)
  })

  it('marks expired keys without reading them and missing objects as expired', async () => {
    const expiredKey = freshKey('old', 45)
    const goneKey = freshKey('gone')
    const spans = [llmSpan('s1', contentKeys(expiredKey)), llmSpan('s2', contentKeys(goneKey))]
    storedRows(spans)
    mockReadArtifact.mockResolvedValue({ status: 'missing' })
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'full', retentionDays: 30 })
    expect(result.bySpanId.get('s1')).toEqual({ status: 'expired' })
    expect(result.bySpanId.get('s2')).toEqual({ status: 'expired' })
    expect(mockReadArtifact).toHaveBeenCalledTimes(1)
    expect(mockReadArtifact.mock.calls[0][3]).toBe(goneKey)
    expect(mockRecordAccess).not.toHaveBeenCalled()
  })

  it('takes retention from the tenant capture policy when not given', async () => {
    const key = freshKey('req', 10)
    const spans = [llmSpan('s1', contentKeys(key))]
    storedRows(spans)
    mockReadPolicy.mockResolvedValue({ policy: { retentionDays: 7 }, source: 'tenant', updatedAt: null })
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'full' })
    expect(mockReadPolicy).toHaveBeenCalledWith(container, TENANT)
    expect(result.bySpanId.get('s1')).toEqual({ status: 'expired' })
    expect(mockReadArtifact).not.toHaveBeenCalled()
  })

  it('reports unavailable storage and keeps the readable side', async () => {
    const requestKey = freshKey('req')
    const responseKey = freshKey('res')
    const spans = [llmSpan('s1', contentKeys(requestKey, responseKey))]
    storedRows(spans)
    mockReadArtifact.mockImplementation(async (_container, _scope, _ref, key) =>
      key === requestKey ? { status: 'ok', value: REQUEST_ARTIFACT } : { status: 'unavailable' },
    )
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'full', retentionDays: 30 })
    expect(result.bySpanId.get('s1')).toEqual({ status: 'unavailable', request: REQUEST_ARTIFACT })
    expect(mockRecordAccess).toHaveBeenCalledTimes(1)
  })

  it('stops at the per-run byte budget', async () => {
    const spans = Array.from({ length: 6 }, (_, index) => llmSpan(`s${index}`, contentKeys(freshKey(`req${index}`))))
    storedRows(spans)
    const payload = { schema: 'om.llm_request.v1', system: 'x'.repeat(400), messages: [], tools: [], params: {} }
    mockReadArtifact.mockResolvedValue({ status: 'ok', value: payload })
    const result = await loadRunExportContent(container, bundleOf(spans), {
      mode: 'full',
      retentionDays: 30,
      maxBytes: 1000,
    })
    const statuses = spans.map((span) => result.bySpanId.get(span.id)?.status)
    expect(statuses.filter((status) => status === 'exported')).toHaveLength(2)
    expect(statuses.filter((status) => status === 'over_budget')).toHaveLength(4)
    for (const span of spans) {
      const entry = result.bySpanId.get(span.id)
      if (entry?.status === 'over_budget') expect(entry.request).toBeUndefined()
    }
  })

  it('never reads more than the concurrency limit at once', async () => {
    const spans = Array.from({ length: 10 }, (_, index) => llmSpan(`s${index}`, contentKeys(freshKey(`req${index}`))))
    storedRows(spans)
    let active = 0
    let peak = 0
    mockReadArtifact.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return { status: 'ok', value: RESPONSE_ARTIFACT }
    })
    await loadRunExportContent(container, bundleOf(spans), { mode: 'full', retentionDays: 30 })
    expect(mockReadArtifact).toHaveBeenCalledTimes(10)
    expect(peak).toBeLessThanOrEqual(OTEL_CONTENT_READ_CONCURRENCY)
  })

  it('reads only keys a stored llm span of the run references', async () => {
    const plantedKey = freshKey('planted')
    const spans = [llmSpan('s1', contentKeys(plantedKey)), llmSpan('s2', contentKeys(freshKey('other')))]
    mockFindWithDecryption.mockResolvedValue([
      { id: 's1', attributes: {} },
      { id: 's2', attributes: contentKeys(freshKey('different')) },
    ])
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'full', retentionDays: 30 })
    expect(mockReadArtifact).not.toHaveBeenCalled()
    expect(result.bySpanId.get('s1')).toEqual({ status: 'not_captured' })
    expect(result.bySpanId.get('s2')).toEqual({ status: 'not_captured' })
    const where = mockFindWithDecryption.mock.calls[0][2]
    expect(where).toEqual({ agentRunId: RUN_ID, tenantId: TENANT, organizationId: ORG, kind: 'llm' })
  })

  it('marks llm spans without content keys as not captured and skips non-llm spans', async () => {
    const toolSpan: RunExportSpan = { ...llmSpan('t1', contentKeys(freshKey('x'))), kind: 'tool' }
    const spans = [llmSpan('s1', null), toolSpan]
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'full', retentionDays: 30 })
    expect(result.bySpanId.get('s1')).toEqual({ status: 'not_captured' })
    expect(result.bySpanId.has('t1')).toBe(false)
    expect(mockReadArtifact).not.toHaveBeenCalled()
  })

  it('never throws and reports the failure', async () => {
    const spans = [llmSpan('s1', contentKeys(freshKey('req')))]
    mockFindWithDecryption.mockRejectedValue(new Error('db down'))
    const result = await loadRunExportContent(container, bundleOf(spans), { mode: 'full', retentionDays: 30 })
    expect(result.bySpanId.get('s1')).toEqual({ status: 'unavailable' })
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'agent_orchestrator.otel_export_content_failed' }),
    )
  })
})
