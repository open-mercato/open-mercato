/** @jest-environment node */
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { DEFAULT_WEBHOOK_BODY_LIMIT_BYTES } from '@open-mercato/shared/lib/webhooks'
import { traceIngestSchema } from '../data/validators'
import { enforcePublicEndpointRateLimit } from '../lib/guardrails/publicEndpointRateLimit'
import { signTraceIngest, TRACE_INGEST_HEADERS, verifyTraceIngestRequest } from '../lib/trace/ingestAuth'
import { POST } from '../api/trace/ingest/route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('../lib/guardrails/publicEndpointRateLimit', () => ({
  enforcePublicEndpointRateLimit: jest.fn(),
}))

jest.mock('../lib/trace/ingestAuth', () => {
  const actual = jest.requireActual<typeof import('../lib/trace/ingestAuth')>('../lib/trace/ingestAuth')
  return { ...actual, verifyTraceIngestRequest: jest.fn(actual.verifyTraceIngestRequest) }
})

const tenantId = '11111111-1111-1111-1111-111111111111'
const organizationId = '22222222-2222-2222-2222-222222222222'
const encoder = new TextEncoder()
const execute = jest.fn()
const resolve = jest.fn()
const safeParse = jest.spyOn(traceIngestSchema, 'safeParse')
const originalSecret = process.env.JWT_SECRET
const originalBodyLimit = process.env.OM_WEBHOOK_MAX_BODY_BYTES
const acceptedResult = { runId: 'run-1', created: true, spansAppended: 0, toolCallsAppended: 0 }

function payloadAtSize(size?: number): string {
  const body = JSON.stringify({ runtime: 'in-process', externalRunId: 'external-1', agentId: 'agent-1', input: '€' })
  return size === undefined ? body : body + ' '.repeat(size - encoder.encode(body).byteLength)
}

function signedHeaders(body: string, contentLength?: string): Headers {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const headers = new Headers({
    'content-type': 'application/json',
    [TRACE_INGEST_HEADERS.tenant]: tenantId,
    [TRACE_INGEST_HEADERS.organization]: organizationId,
    [TRACE_INGEST_HEADERS.id]: 'message-1',
    [TRACE_INGEST_HEADERS.timestamp]: timestamp,
    [TRACE_INGEST_HEADERS.signature]: signTraceIngest(tenantId, 'message-1', timestamp, body),
  })
  if (contentLength !== undefined) headers.set('content-length', contentLength)
  return headers
}

function streamingRequest(body: string, contentLength?: string) {
  const bytes = encoder.encode(body)
  const multibyteOffset = bytes.indexOf(0xe2)
  const chunks = [bytes.slice(0, multibyteOffset + 1), bytes.slice(multibyteOffset + 1, -1), bytes.slice(-1)]
  let nextChunk = 0
  const cancel = jest.fn()
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[nextChunk]
      nextChunk += 1
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    cancel,
  }, { highWaterMark: 0 })
  const request = new Request('http://localhost/api/agent_orchestrator/trace/ingest', {
    method: 'POST',
    headers: signedHeaders(body, contentLength),
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  return { request, cancel }
}

function expectNoDownstreamWork() {
  expect(verifyTraceIngestRequest).not.toHaveBeenCalled()
  expect(safeParse).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
  expect(resolve).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.OM_WEBHOOK_MAX_BODY_BYTES
  process.env.JWT_SECRET = 'test-trace-ingest-route-secret-at-least-32-characters'
  execute.mockResolvedValue({ result: acceptedResult })
  resolve.mockImplementation((name: string) => {
    if (name === 'commandBus') return { execute }
    throw new Error(`[internal] Unexpected dependency ${name}`)
  })
  jest.mocked(createRequestContainer).mockResolvedValue({ resolve } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
  jest.mocked(enforcePublicEndpointRateLimit).mockResolvedValue(null)
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = originalSecret
  if (originalBodyLimit === undefined) delete process.env.OM_WEBHOOK_MAX_BODY_BYTES
  else process.env.OM_WEBHOOK_MAX_BODY_BYTES = originalBodyLimit
})

describe('trace ingest request body limit', () => {
  it('accepts a legitimate signed trace with the verified tenant and organization', async () => {
    const body = payloadAtSize()
    const { request } = streamingRequest(body)

    const response = await POST(request)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, ...acceptedResult })
    expect(verifyTraceIngestRequest).toHaveBeenCalledWith(request.headers, body)
    expect(execute).toHaveBeenCalledWith('agent_orchestrator.trace.ingest', {
      input: { tenantId, organizationId, payload: JSON.parse(body) },
      ctx: expect.objectContaining({ selectedOrganizationId: organizationId, organizationIds: [organizationId], systemActor: true }),
    })
  })

  it('rejects an oversized declared length without consuming the body', async () => {
    const { request } = streamingRequest(payloadAtSize(), String(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES + 1))

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload_too_large' })
    expect(request.bodyUsed).toBe(false)
    expectNoDownstreamWork()
  })

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-number'],
    ['false', '1'],
  ])('rejects a stream crossing the default byte limit with %s Content-Length', async (_label, contentLength) => {
    const { request, cancel } = streamingRequest(payloadAtSize(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES + 1), contentLength)

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload_too_large' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(request.body?.locked).toBe(false)
    expectNoDownstreamWork()
  })

  it.each([
    ['missing', undefined],
    ['exact', String(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES)],
  ])('accepts a signed exact-boundary stream with split UTF-8 and %s Content-Length', async (_label, contentLength) => {
    const body = payloadAtSize(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES)
    const { request, cancel } = streamingRequest(body, contentLength)

    const response = await POST(request)

    expect(response.status).toBe(202)
    expect(verifyTraceIngestRequest).toHaveBeenCalledWith(request.headers, body)
    expect(safeParse).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('enforces the shared configured limit against streamed bytes', async () => {
    process.env.OM_WEBHOOK_MAX_BODY_BYTES = '128'
    const { request, cancel } = streamingRequest(payloadAtSize(129), '1')

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(cancel).toHaveBeenCalledTimes(1)
    expectNoDownstreamWork()
  })

  it('accepts a signed body exactly at the shared configured limit', async () => {
    process.env.OM_WEBHOOK_MAX_BODY_BYTES = '128'
    const { request } = streamingRequest(payloadAtSize(128), '128')

    expect((await POST(request)).status).toBe(202)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('preserves the rate-limit response before reading an oversized body', async () => {
    jest.mocked(enforcePublicEndpointRateLimit).mockResolvedValue(NextResponse.json({ error: 'rate_limited' }, { status: 429 }))
    const { request } = streamingRequest(payloadAtSize(), String(DEFAULT_WEBHOOK_BODY_LIMIT_BYTES + 1))

    const response = await POST(request)

    expect(response.status).toBe(429)
    expect(request.bodyUsed).toBe(false)
    expectNoDownstreamWork()
  })

  it('propagates non-size stream failures before authentication or commands', async () => {
    const failure = new Error('[internal] Stream failed')
    const request = new Request('http://localhost/api/agent_orchestrator/trace/ingest', {
      method: 'POST',
      headers: signedHeaders('{}'),
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure) } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await expect(POST(request)).rejects.toBe(failure)
    expectNoDownstreamWork()
  })
})
