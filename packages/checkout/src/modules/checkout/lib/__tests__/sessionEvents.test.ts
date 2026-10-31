import { redactSessionEventPayload } from '../sessionEvents'

describe('redactSessionEventPayload (C14)', () => {
  it('strips every known PII-shaped key, recursively, and keeps safe scalars', () => {
    const input = {
      sessionId: 'session-1',
      status: 'open',
      amount: 10,
      active: true,
      email: 'buyer@example.com',
      phone: '+1-555-0100',
      shippingAddress: { line1: '1 Main St', city: 'Springfield' },
      billingAddress: { line1: '1 Main St' },
      firstName: 'Ada',
      lastName: 'Lovelace',
      cardNumber: '4111111111111111',
      gatewaySecret: 'sk_live_xxx',
      nested: {
        email: 'nested@example.com',
        code: 'CODE1',
      },
      changedKeys: ['email', 'phone'],
    }

    const redacted = redactSessionEventPayload(input)

    expect(redacted).toEqual({
      sessionId: 'session-1',
      status: 'open',
      amount: 10,
      active: true,
      nested: { code: 'CODE1' },
      changedKeys: ['email', 'phone'],
    })
    expect(JSON.stringify(redacted)).not.toMatch(/buyer@example\.com|555-0100|Main St|Ada|Lovelace|4111111111111111|sk_live_xxx/)
  })

  it('returns null for a null/undefined payload', () => {
    expect(redactSessionEventPayload(null)).toBeNull()
    expect(redactSessionEventPayload(undefined)).toBeNull()
  })

  it('drops functions and keeps dates as ISO strings', () => {
    const now = new Date('2026-10-27T00:00:00.000Z')
    const redacted = redactSessionEventPayload({
      createdAt: now,
      handler: () => undefined,
    })
    expect(redacted).toEqual({ createdAt: now.toISOString() })
  })
})
