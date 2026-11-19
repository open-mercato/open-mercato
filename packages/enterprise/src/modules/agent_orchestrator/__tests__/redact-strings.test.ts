import { redactPii, redactAttributes } from '../../../../../telemetry/src/facade/redact'
import { redactAttributeValues, redactEmails, redactSecretStrings, redactString } from '../lib/trace/redactStrings'

const SAMPLES = [
  'Error: no user for jan.kowalski@example.com',
  'Authorization: Bearer abc.def.ghi',
  'request failed; cookie=sid=123; other',
  'sent Basic dXNlcjpwYXNz to host',
  'ApiKey sk_live_12345 leaked',
  'nothing sensitive here',
]

describe('redactStrings', () => {
  it('matches telemetry redactPii on shared samples', () => {
    for (const sample of SAMPLES) {
      expect(redactEmails(redactSecretStrings(sample))).toBe(redactPii(sample))
    }
  })

  it('matches telemetry redactAttributes on flat bags', () => {
    const bag = {
      'x-api-key': 'k',
      authorization: 'Bearer z',
      note: 'mail a@b.io',
      token_count: 5,
      token: 'abc',
      flag: true,
    }
    expect(redactAttributeValues(bag)).toEqual(redactAttributes(bag))
  })

  it('redacts the OpenCode session authorization line', () => {
    const line = '[Session Authorization: sess_abc.123-xyz. Include "_sessionToken": "sess_abc.123-xyz" in EVERY tool call.]'
    const out = redactSecretStrings(line)
    expect(out).not.toContain('sess_abc')
    expect(out).toContain('Session Authorization: [redacted]')
  })

  it('redacts a lone _sessionToken field', () => {
    expect(redactSecretStrings('{"_sessionToken":"abc123"}')).toBe('{"_sessionToken":"[redacted]"}')
  })

  it('recurses arrays and objects, masks secret keys, leaves non-strings', () => {
    const input = {
      list: ['mail me@x.org', 3, null, { password: 'p', inner: 'Bearer t0k' }],
      nested: { api_key: 'k', count: 2, when: new Date(0) },
    }
    const out = redactAttributeValues(input)
    expect(out).toEqual({
      list: ['mail [redacted-email]', 3, null, { password: '[redacted]', inner: 'Bearer [redacted]' }],
      nested: { api_key: '[redacted]', count: 2, when: input.nested.when },
    })
    expect(out).not.toBe(input)
    expect(input.list[0]).toBe('mail me@x.org')
  })

  it('never throws on cyclic input and masks what lies past the depth cap', () => {
    const cyclic: Record<string, unknown> = { a: 'x' }
    cyclic.self = cyclic
    expect(() => redactAttributeValues(cyclic)).not.toThrow()
    let cursor = redactAttributeValues(cyclic) as Record<string, unknown>
    let depth = 0
    while (typeof cursor.self === 'object' && cursor.self !== null) {
      cursor = cursor.self as Record<string, unknown>
      depth += 1
    }
    expect(cursor.self).toBe('[redacted]')
    expect(depth).toBeLessThan(20)
  })

  it('masks a nested value past the depth cap instead of returning it raw', () => {
    let nested: Record<string, unknown> = { leak: 'mail me@x.org' }
    for (let level = 0; level < 20; level += 1) nested = { child: nested }
    expect(JSON.stringify(redactAttributeValues(nested))).not.toContain('me@x.org')
  })

  it('fails closed with an empty bag when scrubbing throws', () => {
    const hostile = {
      get boom(): string {
        throw new Error('getter exploded')
      },
      note: 'mail me@x.org',
    }
    expect(redactAttributeValues(hostile)).toEqual({})
  })

  it('redactString applies both secret and email redaction', () => {
    expect(redactString('Bearer abc for me@x.org')).toBe('Bearer [redacted] for [redacted-email]')
  })
})
