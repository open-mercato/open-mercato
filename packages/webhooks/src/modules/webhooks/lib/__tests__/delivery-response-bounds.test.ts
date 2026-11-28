import type { EntityManager } from '@mikro-orm/postgresql'
import { processWebhookDeliveryJob } from '../delivery'

jest.mock('../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(async () => true),
  WEBHOOK_INTEGRATION_DISABLED_MESSAGE: 'disabled',
}))

jest.mock('@open-mercato/shared/lib/webhooks', () => ({
  buildWebhookHeaders: jest.fn(() => ({})),
  generateMessageId: jest.fn(() => 'msg-1'),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitWebhooksEvent } from '../../events'

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const emitWebhooksEventMock = emitWebhooksEvent as jest.MockedFunction<typeof emitWebhooksEvent>

const RESPONSE_BODY_LIMIT_BYTES = 4096
const encoder = new TextEncoder()

type DeliveryRecord = {
  id: string
  tenantId: string
  organizationId: string
  webhookId: string
  status: string
  payload: Record<string, unknown>
  enqueuedAt: Date
  eventType: string
  maxAttempts: number
  attemptNumber: number
  messageId: string
  responseBody: string | null
  responseHeaders: Record<string, string> | null
  responseStatus: number | null
  nextRetryAt: Date | null
  errorMessage: string | null
  lastAttemptAt: Date | null
  deliveredAt: Date | null
  durationMs: number | null
}

function buildDelivery(): DeliveryRecord {
  return {
    id: 'delivery-1',
    tenantId: 't',
    organizationId: 'o',
    webhookId: 'w-1',
    status: 'pending',
    payload: { type: 'x', timestamp: new Date().toISOString(), data: {} },
    enqueuedAt: new Date(),
    eventType: 'x',
    maxAttempts: 3,
    attemptNumber: 0,
    messageId: 'msg-1',
    responseBody: 'stale body from a previous attempt',
    responseHeaders: null,
    responseStatus: null,
    nextRetryAt: null,
    errorMessage: null,
    lastAttemptAt: null,
    deliveredAt: null,
    durationMs: null,
  }
}

function buildWebhook(timeoutMs: number) {
  return {
    id: 'w-1',
    url: 'http://127.0.0.1:3001/hook',
    isActive: true,
    timeoutMs,
    httpMethod: 'POST',
    customHeaders: null,
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    autoDisableThreshold: 0,
    maxRetries: 3,
    secret: 'secret',
    previousSecret: null,
    tenantId: 't',
    organizationId: 'o',
  }
}

function buildEm(delivery: DeliveryRecord) {
  return {
    findOne: jest.fn(async () => delivery),
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
}

function mockFetchResponse(response: Response) {
  globalThis.fetch = jest.fn(async () => response) as unknown as typeof fetch
}

async function runWithin<T>(promise: Promise<T>, limitMs: number): Promise<T | 'still-pending'> {
  let sentinel: ReturnType<typeof setTimeout> | undefined
  const pending = new Promise<'still-pending'>((resolve) => {
    sentinel = setTimeout(() => resolve('still-pending'), limitMs)
  })
  try {
    return await Promise.race([promise, pending])
  } finally {
    if (sentinel) clearTimeout(sentinel)
  }
}

async function runJob(delivery: DeliveryRecord, timeoutMs: number) {
  findOneWithDecryptionMock.mockResolvedValueOnce(buildWebhook(timeoutMs) as never)
  return processWebhookDeliveryJob(buildEm(delivery), {
    deliveryId: delivery.id,
    tenantId: 't',
    organizationId: 'o',
  }, { scheduleRetries: false })
}

describe('processWebhookDeliveryJob — bounded response body reads (#7226)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS = '1'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OM_WEBHOOKS_ALLOW_PRIVATE_URLS
  })

  function stalledBodyAfter(status: number, onCancel: () => void, headers: Record<string, string> = {}) {
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('partial'))
      },
      pull() {
        return new Promise<void>(() => undefined)
      },
      cancel() {
        onCancel()
      },
    })
    return new Response(stalledBody, { status, headers })
  }

  it('(a) classifies a 2xx by its status with the partial body when the body stalls past the deadline', async () => {
    let cancelled = false
    mockFetchResponse(stalledBodyAfter(200, () => { cancelled = true }, {
      'content-type': 'text/plain',
      'x-receiver': 'stall',
    }))

    const delivery = buildDelivery()
    const timeoutMs = 150
    const startedAt = Date.now()
    const outcome = await runWithin(runJob(delivery, timeoutMs), 3000)

    expect(outcome).not.toBe('still-pending')
    expect(Date.now() - startedAt).toBeLessThan(timeoutMs + 1000)
    expect(cancelled).toBe(true)
    expect(delivery.status).toBe('delivered')
    expect(delivery.attemptNumber).toBe(1)
    expect(delivery.deliveredAt).toEqual(expect.any(Date))
    expect(delivery.responseStatus).toBe(200)
    expect(delivery.responseBody).toBe('partial')
    expect(delivery.responseHeaders).toEqual(expect.objectContaining({ 'x-receiver': 'stall' }))
    expect(delivery.errorMessage).toBeNull()
    expect(emitWebhooksEventMock).toHaveBeenCalledWith(
      'webhooks.delivery.succeeded',
      expect.objectContaining({ deliveryId: delivery.id }),
    )
    expect(emitWebhooksEventMock).not.toHaveBeenCalledWith('webhooks.delivery.failed', expect.anything())
  })

  it('(a2) expires a non-retryable 4xx whose body stalls past the deadline', async () => {
    let cancelled = false
    mockFetchResponse(stalledBodyAfter(400, () => { cancelled = true }))

    const delivery = buildDelivery()
    const outcome = await runWithin(runJob(delivery, 150), 3000)

    expect(outcome).not.toBe('still-pending')
    expect(cancelled).toBe(true)
    expect(delivery.status).toBe('expired')
    expect(delivery.attemptNumber).toBe(1)
    expect(delivery.responseStatus).toBe(400)
    expect(delivery.responseBody).toBe('partial')
    expect(delivery.nextRetryAt).toBeNull()
    expect(emitWebhooksEventMock).toHaveBeenCalledWith(
      'webhooks.delivery.failed',
      expect.objectContaining({ responseStatus: 400, willRetry: false }),
    )
  })

  it('(a3) retries a 5xx whose body stalls past the deadline', async () => {
    mockFetchResponse(stalledBodyAfter(503, () => undefined))

    const delivery = buildDelivery()
    const outcome = await runWithin(runJob(delivery, 150), 3000)

    expect(outcome).not.toBe('still-pending')
    expect(delivery.status).toBe('pending')
    expect(delivery.attemptNumber).toBe(1)
    expect(delivery.responseStatus).toBe(503)
    expect(delivery.responseBody).toBe('partial')
    expect(delivery.nextRetryAt).toEqual(expect.any(Date))
    expect(emitWebhooksEventMock).toHaveBeenCalledWith(
      'webhooks.delivery.failed',
      expect.objectContaining({ responseStatus: 503, willRetry: true }),
    )
  })

  it('(e) clears the previous attempt response when the next attempt fails before headers', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    const delivery = {
      ...buildDelivery(),
      attemptNumber: 1,
      responseStatus: 500,
      responseHeaders: { 'x-previous': 'attempt' },
      responseBody: 'previous failure body',
    }
    await runJob(delivery, 5000)

    expect(delivery.status).toBe('pending')
    expect(delivery.attemptNumber).toBe(2)
    expect(delivery.errorMessage).toBe('connect ECONNREFUSED')
    expect(delivery.responseStatus).toBeNull()
    expect(delivery.responseHeaders).toBeNull()
    expect(delivery.responseBody).toBeNull()
  })

  it('(f) keeps the received status and headers when the connection fails mid-body', async () => {
    const brokenBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('partial'))
      },
      pull(controller) {
        controller.error(new Error('socket hang up'))
      },
    })
    mockFetchResponse(new Response(brokenBody, { status: 200, headers: { 'x-receiver': 'reset' } }))

    const delivery = buildDelivery()
    await runJob(delivery, 5000)

    expect(delivery.status).toBe('pending')
    expect(delivery.attemptNumber).toBe(1)
    expect(delivery.errorMessage).toBe('socket hang up')
    expect(delivery.responseStatus).toBe(200)
    expect(delivery.responseHeaders).toEqual(expect.objectContaining({ 'x-receiver': 'reset' }))
    expect(delivery.responseBody).toBeNull()
  })

  it('(b) stores at most the response-log limit and cancels a large streamed body before consuming it', async () => {
    const chunkBytes = 512
    const totalChunks = 2048
    let pulls = 0
    let cancelled = false
    const largeBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls > totalChunks) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode('x'.repeat(chunkBytes)))
      },
      cancel() {
        cancelled = true
      },
    }, { highWaterMark: 0 })
    mockFetchResponse(new Response(largeBody, { status: 200 }))

    const delivery = buildDelivery()
    const outcome = await runWithin(runJob(delivery, 5000), 3000)

    expect(outcome).not.toBe('still-pending')
    expect(delivery.status).toBe('delivered')
    expect(delivery.responseStatus).toBe(200)
    expect(Buffer.byteLength(delivery.responseBody ?? '', 'utf8')).toBeLessThanOrEqual(RESPONSE_BODY_LIMIT_BYTES)
    expect((delivery.responseBody ?? '').length).toBeGreaterThan(0)
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThanOrEqual(Math.ceil(RESPONSE_BODY_LIMIT_BYTES / chunkBytes) + 2)
  })

  it('(c) keeps small bodies, status and headers unchanged for success, failure and empty responses', async () => {
    mockFetchResponse(new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }))
    const delivered = buildDelivery()
    await runJob(delivered, 5000)
    expect(delivered.status).toBe('delivered')
    expect(delivered.responseBody).toBe('ok')
    expect(delivered.responseStatus).toBe(200)
    expect(delivered.responseHeaders).toEqual(expect.objectContaining({ 'content-type': 'text/plain' }))
    expect(delivered.errorMessage).toBeNull()

    mockFetchResponse(new Response('boom', { status: 500 }))
    const failed = buildDelivery()
    await runJob(failed, 5000)
    expect(failed.status).toBe('pending')
    expect(failed.responseStatus).toBe(500)
    expect(failed.responseBody).toBe('boom')

    mockFetchResponse(new Response('nope', { status: 400 }))
    const rejected = buildDelivery()
    await runJob(rejected, 5000)
    expect(rejected.status).toBe('expired')
    expect(rejected.responseStatus).toBe(400)
    expect(rejected.responseBody).toBe('nope')

    mockFetchResponse(new Response(null, { status: 204 }))
    const empty = buildDelivery()
    await runJob(empty, 5000)
    expect(empty.status).toBe('delivered')
    expect(empty.responseBody).toBe('')
  })

  it('(d) truncates by bytes on a UTF-8 boundary without emitting a replacement character', async () => {
    const multiByteBody = 'a' + 'é'.repeat(4000)
    mockFetchResponse(new Response(multiByteBody, { status: 200 }))

    const delivery = buildDelivery()
    await runJob(delivery, 5000)

    const stored = delivery.responseBody ?? ''
    expect(Buffer.byteLength(stored, 'utf8')).toBeLessThanOrEqual(RESPONSE_BODY_LIMIT_BYTES)
    expect(stored).not.toContain('�')
    expect(multiByteBody.startsWith(stored)).toBe(true)
    expect(stored.length).toBe(1 + 2047)
  })
})
