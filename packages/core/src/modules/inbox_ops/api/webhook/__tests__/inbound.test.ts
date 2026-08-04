/** @jest-environment node */

import { createHmac } from 'node:crypto'
import { POST } from '../inbound'
import { InboxSettings, InboxEmail } from '../../../data/entities'

interface MockEntityManager {
  fork: jest.Mock<MockEntityManager, []>
  findOne: jest.Mock<Promise<unknown>, [unknown, Record<string, unknown>?]>
  create: jest.Mock<Record<string, unknown>, [unknown, Record<string, unknown>]>
  persist: jest.Mock<void, [unknown]>
  flush: jest.Mock<Promise<void>, []>
}

const mockEm: MockEntityManager = {
  fork: jest.fn<MockEntityManager, []>(),
  findOne: jest.fn<Promise<unknown>, [unknown, Record<string, unknown>?]>(),
  create: jest.fn<Record<string, unknown>, [unknown, Record<string, unknown>]>(),
  persist: jest.fn<void, [unknown]>(),
  flush: jest.fn<Promise<void>, []>(),
}

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

const mockEmitInboxOpsEvent = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => mockEmitInboxOpsEvent(...args),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/rateLimiter', () => ({
  checkRateLimit: jest.fn(() => ({ allowed: true })),
}))

const WEBHOOK_SECRET = 'test-webhook-secret'

function makeSignatureWith(secret: string, body: string, timestamp: string) {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
  return `sha256=${expected}`
}

function makeSignature(body: string, timestamp: string) {
  return makeSignatureWith(WEBHOOK_SECRET, body, timestamp)
}

function makeSignedRequestWith(secret: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = makeSignatureWith(secret, body, timestamp)

  return new Request('http://localhost/api/inbox_ops/webhook/inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(body.length),
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
    body,
  })
}

function makeSignedRequest(payload: Record<string, unknown>) {
  return makeSignedRequestWith(WEBHOOK_SECRET, payload)
}

const validPayload = {
  from: 'John Doe <john@example.com>',
  to: 'ops-123@inbox.mercato.local',
  subject: 'New order',
  text: 'Please create an order for 10 widgets.',
  messageId: '<msg-001@example.com>',
}

const mockSettings = {
  id: 'settings-1',
  inboxAddress: 'ops-123@inbox.mercato.local',
  isActive: true,
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  deletedAt: null,
}

describe('POST /api/inbox_ops/webhook/inbound', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.INBOX_OPS_WEBHOOK_SECRET = WEBHOOK_SECRET
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.flush.mockResolvedValue(undefined)
    mockEmitInboxOpsEvent.mockResolvedValue(undefined)
    mockEm.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      id: 'email-1',
      ...data,
    }))
  })

  afterEach(() => {
    delete process.env.INBOX_OPS_WEBHOOK_SECRET
  })

  it('returns 503 when webhook secret is not configured', async () => {
    delete process.env.INBOX_OPS_WEBHOOK_SECRET

    const response = await POST(makeSignedRequest(validPayload))
    expect(response.status).toBe(503)
  })

  it('returns 400 for invalid HMAC signature', async () => {
    const body = JSON.stringify(validPayload)
    const timestamp = String(Math.floor(Date.now() / 1000))

    const request = new Request('http://localhost/api/inbox_ops/webhook/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'x-webhook-signature': 'sha256=invalid_signature_here',
        'x-webhook-timestamp': timestamp,
      },
      body,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toContain('Invalid signature')
  })

  it('returns 400 for replay attack (old timestamp)', async () => {
    const body = JSON.stringify(validPayload)
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600) // 10 minutes ago
    const signature = makeSignature(body, oldTimestamp)

    const request = new Request('http://localhost/api/inbox_ops/webhook/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'x-webhook-signature': signature,
        'x-webhook-timestamp': oldTimestamp,
      },
      body,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 413 for oversized payload', async () => {
    const body = JSON.stringify(validPayload)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = makeSignature(body, timestamp)

    const request = new Request('http://localhost/api/inbox_ops/webhook/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(3 * 1024 * 1024), // 3MB
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      },
      body,
    })

    const response = await POST(request)
    expect(response.status).toBe(413)
    expect(mockContainer.resolve).not.toHaveBeenCalled()
  })

  it('returns 400 when missing recipient address', async () => {
    const payloadNoTo = { ...validPayload, to: undefined }
    const response = await POST(makeSignedRequest(payloadNoTo as any))
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.error).toContain('Missing recipient')
  })

  it('returns 200 (silent OK) when no matching settings found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await POST(makeSignedRequest(validPayload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(mockEm.create).not.toHaveBeenCalled()
  })

  it('creates email and emits event for valid payload', async () => {
    mockFindOneWithDecryption
      .mockResolvedValueOnce(mockSettings) // InboxSettings found
      .mockResolvedValueOnce(null)         // no duplicate by messageId
      .mockResolvedValueOnce(null)         // no duplicate by contentHash

    const response = await POST(makeSignedRequest(validPayload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(mockEm.create).toHaveBeenCalledWith(
      InboxEmail,
      expect.objectContaining({
        subject: 'New order',
        forwardedByAddress: 'john@example.com',
        status: 'received',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
    expect(mockEm.persist).toHaveBeenCalled()
    expect(mockEm.flush).toHaveBeenCalled()
    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.email.received',
      expect.objectContaining({
        emailId: 'email-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
  })

  it('deduplicates by messageId and returns OK without creating', async () => {
    const existingEmail = { id: 'existing-1', messageId: '<msg-001@example.com>' }
    mockFindOneWithDecryption
      .mockResolvedValueOnce(mockSettings)   // settings
      .mockResolvedValueOnce(existingEmail)  // duplicate by messageId

    const response = await POST(makeSignedRequest(validPayload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.email.deduplicated',
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
  })

  it('deduplicates by contentHash when messageId is new', async () => {
    const existingByHash = { id: 'existing-2', contentHash: 'abc123' }
    mockFindOneWithDecryption
      .mockResolvedValueOnce(mockSettings)   // settings
      .mockResolvedValueOnce(null)           // no messageId match
      .mockResolvedValueOnce(existingByHash) // duplicate by contentHash

    const response = await POST(makeSignedRequest(validPayload))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(mockEm.create).not.toHaveBeenCalled()
  })

  it('handles missing signature header', async () => {
    const body = JSON.stringify(validPayload)
    const request = new Request('http://localhost/api/inbox_ops/webhook/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
      },
      body,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 for malformed JSON body', async () => {
    const malformedBody = '{not valid json'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = makeSignature(malformedBody, timestamp)

    const request = new Request('http://localhost/api/inbox_ops/webhook/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(malformedBody.length),
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      },
      body: malformedBody,
    })

    const response = await POST(request)
    const result = await response.json()

    expect(response.status).toBe(400)
    expect(result.error).toContain('Invalid JSON')
  })

  it('returns 429 when rate limiter rejects the request', async () => {
    const { checkRateLimit } = jest.requireMock('@open-mercato/core/modules/inbox_ops/lib/rateLimiter') as {
      checkRateLimit: jest.Mock
    }
    checkRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 30 })

    const response = await POST(makeSignedRequest(validPayload))
    const result = await response.json()

    expect(response.status).toBe(429)
    expect(result.error).toContain('Rate limit')
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('keys the pre-DB global bucket on the secret, not the per-request signature (issue #2698)', async () => {
    // Regression: keying the global bucket on the mutable per-request signature
    // would mint a fresh bucket for every request (different body/timestamp), so
    // the throttle could never accumulate. The key must be request-invariant for
    // a fixed signing secret so a flood with a rotating body is still capped.
    const { checkRateLimit } = jest.requireMock('@open-mercato/core/modules/inbox_ops/lib/rateLimiter') as {
      checkRateLimit: jest.Mock
    }
    mockFindOneWithDecryption.mockResolvedValue(null)

    await POST(makeSignedRequest({ ...validPayload, subject: 'first body variant' }))
    await POST(makeSignedRequest({ ...validPayload, subject: 'second different body' }))

    const customGlobalKeys = checkRateLimit.mock.calls
      .map((call) => call[1] as string)
      .filter((key) => key.startsWith('webhook:secret:'))

    expect(customGlobalKeys.length).toBe(2)
    expect(customGlobalKeys[0]).toBe(customGlobalKeys[1])
  })

  describe('per-tenant webhook secret binding (issue #2698)', () => {
    const TENANT_SECRET = 'per-tenant-secret-abcdefabcdef'
    const settingsWithSecret = { ...mockSettings, webhookSecret: TENANT_SECRET }

    it('rejects the GLOBAL secret when the target inbox has its own secret', async () => {
      // Settings (with a per-tenant secret) resolve fine, but the request was
      // signed with the global secret — it must NOT be accepted for this inbox.
      mockFindOneWithDecryption.mockResolvedValueOnce(settingsWithSecret)

      const response = await POST(makeSignedRequestWith(WEBHOOK_SECRET, validPayload))
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toContain('Invalid signature')
      expect(mockEm.create).not.toHaveBeenCalled()
    })

    it('accepts a signature made with the inbox-specific secret', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce(settingsWithSecret) // settings found
        .mockResolvedValueOnce(null) // no dup by messageId
        .mockResolvedValueOnce(null) // no dup by contentHash

      const response = await POST(makeSignedRequestWith(TENANT_SECRET, validPayload))
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.ok).toBe(true)
      expect(mockEm.create).toHaveBeenCalled()
    })

    it('still accepts the global secret when the inbox has no per-tenant secret', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce(mockSettings) // no webhookSecret on this inbox
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)

      const response = await POST(makeSignedRequestWith(WEBHOOK_SECRET, validPayload))
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.ok).toBe(true)
      expect(mockEm.create).toHaveBeenCalled()
    })

    it('returns silent 200 for an unknown inbox only when the global signature is valid', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null) // no settings for this `to`

      const response = await POST(makeSignedRequestWith(WEBHOOK_SECRET, validPayload))
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.ok).toBe(true)
      expect(mockEm.create).not.toHaveBeenCalled()
    })

    it('rejects a bogus-secret signature for an unknown inbox (no probe oracle)', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      const response = await POST(makeSignedRequestWith('attacker-guessed-secret-xyz', validPayload))
      const result = await response.json()

      expect(response.status).toBe(400)
      expect(result.error).toContain('Invalid signature')
      expect(mockEm.create).not.toHaveBeenCalled()
    })
  })
})
