import {
  INBOUND_TOKEN_VERSION,
  MAX_INBOUND_BODY_BYTES,
  inboundHookUrl,
  readBoundedBody,
  readInboundPayload,
  signInboundToken,
  verifyInboundToken,
} from '../inbound'
import { signTrackingToken } from '../tracking/token'

const secret = 'test-secret-value'
const claims = { tenantId: 'tenant-1', organizationId: 'org-1', hookId: 'hook-1' }

describe('inbound hook tokens', () => {
  it('round-trips its claims', () => {
    expect(verifyInboundToken(signInboundToken(claims, secret), secret)).toEqual(claims)
  })

  it('refuses a token signed with another secret', () => {
    expect(verifyInboundToken(signInboundToken(claims, secret), 'other-secret')).toBeNull()
  })

  it('refuses a tampered body', () => {
    const token = signInboundToken(claims, secret)
    const [body, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ v: INBOUND_TOKEN_VERSION, t: 'tenant-2', o: 'org-1', h: 'hook-1' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(body).not.toBe(forged)
    expect(verifyInboundToken(`${forged}.${signature}`, secret)).toBeNull()
  })

  it('refuses a tracking token, even one signed with the same secret', () => {
    /**
     * The point of the separate key label. A tracking token verifying here would let anyone holding a
     * click URL from an email post arbitrary payloads into the tenant.
     */
    const tracking = signTrackingToken({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      campaignId: 'campaign-1',
      runId: 'run-1',
      stepId: 'step-1',
      purpose: 'click',
      target: 'https://example.com',
    }, secret)
    expect(verifyInboundToken(tracking, secret)).toBeNull()
  })

  it('refuses shapes that are not a token at all', () => {
    for (const value of ['', '.', 'abc', 'a.b.c', 'not-base64.not-base64']) {
      expect(verifyInboundToken(value, secret)).toBeNull()
    }
  })

  it('builds a URL with the token in a single query parameter', () => {
    const url = inboundHookUrl('https://shop.example/', claims, secret)
    expect(url).toContain('/api/marketing_automation/inbound?t=')
    expect(url).not.toContain('&')
    // No trailing-slash doubling, since the configured base URL may or may not carry one.
    expect(url).not.toContain('shop.example//api')
    const token = new URL(url).searchParams.get('t') ?? ''
    expect(verifyInboundToken(token, secret)).toEqual(claims)
  })

  it('carries no identity of its own beyond the hook', () => {
    const token = signInboundToken(claims, secret)
    const decoded = Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(['h', 'o', 't', 'v'])
  })
})

describe('readInboundPayload', () => {
  it('lifts identity out of the data', () => {
    const payload = readInboundPayload({ customerId: 'c-1', email: 'Someone@Example.COM', orderRef: 'A-9', nested: { a: 1 } })
    expect(payload?.customerId).toBe('c-1')
    // Lower-cased, because an address is not case-sensitive and the matcher normalises too.
    expect(payload?.email).toBe('someone@example.com')
    expect(payload?.data).toEqual({ orderRef: 'A-9', nested: { a: 1 } })
  })

  it('never leaves an address inside the data that gets stored on the run', () => {
    const payload = readInboundPayload({ email: 'someone@example.com' })
    expect(payload?.data).toEqual({})
  })

  it('accepts a body with no identity at all, so the endpoint can record why nothing happened', () => {
    expect(readInboundPayload({ orderRef: 'A-9' })).toEqual({ customerId: undefined, email: undefined, data: { orderRef: 'A-9' } })
  })

  it('treats blank identity fields as absent', () => {
    const payload = readInboundPayload({ customerId: '   ', email: '' })
    expect(payload?.customerId).toBeUndefined()
    expect(payload?.email).toBeUndefined()
  })

  it('refuses anything that is not a JSON object', () => {
    for (const value of [null, undefined, 'string', 42, [], [{ email: 'a@b.c' }]]) {
      expect(readInboundPayload(value)).toBeNull()
    }
  })

  it('caps the body at a size a run context can carry', () => {
    // The payload is re-read on every resume of the run it started, so this is a per-step cost.
    expect(MAX_INBOUND_BODY_BYTES).toBe(16 * 1024)
  })
})

describe('inbound signature malleability', () => {
  test('a valid signature followed by padding and arbitrary text is refused', () => {
    // The same lenient-base64 forgery slot as the tracking token; an inbound hook URL is a credential that
    // enrols real customers, so a non-canonical signature must not verify here either.
    const token = signInboundToken(claims, secret)
    expect(verifyInboundToken(`${token}="><svg onload=alert(1)>`, secret)).toBeNull()
    expect(verifyInboundToken(`${token}=`, secret)).toBeNull()
  })

  test('the canonical token still verifies and has the canonical shape', () => {
    const token = signInboundToken(claims, secret)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(verifyInboundToken(token, secret)).toEqual(claims)
  })
})

/**
 * The body ceiling, enforced WHILE reading.
 *
 * `await req.text()` buffered the whole body first, so the check ran once the memory was already spent — on a
 * PUBLIC endpoint anybody holding a hook URL can post to. These tests hold the reader to the two things that
 * matter: it stops at the ceiling, and it does not believe `content-length`.
 */
describe('readBoundedBody', () => {
  const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> => new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })

  const request = (chunks: Uint8Array[], contentLength?: string) => ({
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength ?? null : null) },
    body: streamOf(chunks),
  })

  const bytes = (count: number) => new Uint8Array(count).fill(0x61)

  it('reads a body inside the limit', async () => {
    const answer = await readBoundedBody(request([Buffer.from('{"a":1}')]), 64)
    expect(answer).toEqual({ ok: true, text: '{"a":1}' })
  })

  /**
   * A hand-rolled reader rather than a `ReadableStream`, because the stream machinery pre-pulls.
   *
   * A real stream fills its internal queue before anybody reads from it, so counting `pull` calls measures the
   * platform rather than this function. Driving the reader directly is what holds the LOGIC — how many chunks it
   * asks for, and whether it cancels — to the assertion.
   */
  const countingBody = (chunkSize: number) => {
    const state = { reads: 0, cancelled: false }
    const body = {
      getReader: () => ({
        read: async () => {
          state.reads += 1
          return { done: false, value: bytes(chunkSize) }
        },
        cancel: async () => { state.cancelled = true },
      }),
    }
    return { state, body: body as unknown as ReadableStream<Uint8Array> }
  }

  it('refuses a declared length over the limit without opening the body at all', async () => {
    let opened = false
    const body = {
      getReader: () => {
        opened = true
        throw new Error('[internal] the body must not be read when content-length already refuses it')
      },
    }
    const req = {
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? '99999' : null) },
      body: body as unknown as ReadableStream<Uint8Array>,
    }
    expect(await readBoundedBody(req, 64)).toEqual({ ok: false })
    expect(opened).toBe(false)
  })

  /**
   * The header is an early refusal, never the answer.
   *
   * It is absent on a chunked request and can simply be wrong, so the running total is what enforces the cap —
   * and a caller who lies about it must not get further than one who tells the truth.
   */
  it('refuses a body that exceeds the limit even with no declared length', async () => {
    expect(await readBoundedBody(request([bytes(40), bytes(40)]), 64)).toEqual({ ok: false })
  })

  it('stops at the ceiling and cancels, rather than draining an endless body', async () => {
    const { state, body } = countingBody(40)
    const answer = await readBoundedBody({ headers: { get: () => null }, body }, 64)
    expect(answer).toEqual({ ok: false })
    // Two 40-byte chunks already pass 64, so it asks for exactly two and stops.
    expect(state.reads).toBe(2)
    expect(state.cancelled).toBe(true)
  })

  it('treats an absent body as an empty one', async () => {
    expect(await readBoundedBody({ headers: { get: () => null }, body: null }, 64)).toEqual({ ok: true, text: '' })
  })
})
