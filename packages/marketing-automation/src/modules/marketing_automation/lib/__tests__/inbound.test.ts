import {
  INBOUND_TOKEN_VERSION,
  MAX_INBOUND_BODY_BYTES,
  inboundHookUrl,
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
