import { redactPii, redactAttributes } from '../facade/redact'

describe('redactPii', () => {
  it('masks email addresses', () => {
    expect(redactPii('no user for jan.kowalski@example.com found')).toBe(
      'no user for [redacted-email] found',
    )
  })

  it('masks every email in the text', () => {
    expect(redactPii('a@b.co and c.d+tag@sub.example.org')).toBe(
      '[redacted-email] and [redacted-email]',
    )
  })

  it('masks an Authorization header dump (scheme + token) in one pass', () => {
    expect(redactPii('request failed: Authorization: Bearer eyJhbGci.abc-123_x')).toBe(
      'request failed: Authorization: [redacted]',
    )
  })

  it('masks a standalone Bearer/Basic/ApiKey token in text', () => {
    expect(redactPii('used Basic dXNlcjpwYXNz to auth')).toBe('used Basic [redacted] to auth')
    expect(redactPii('sent ApiKey sk_live_abc123 upstream')).toBe('sent ApiKey [redacted] upstream')
  })

  it('masks a cookie header dump but keeps surrounding structure', () => {
    expect(redactPii("headers { cookie: 'session=abc123'; x-id: 5 }")).toBe(
      "headers { cookie: [redacted]; x-id: 5 }",
    )
  })

  it('leaves opaque ids/UUIDs untouched (we keep those)', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    expect(redactPii(`tenant ${uuid}`)).toBe(`tenant ${uuid}`)
  })

  it('is a no-op for text with no PII', () => {
    expect(redactPii('connection refused')).toBe('connection refused')
  })
})

describe('redactAttributes', () => {
  it('masks values under secret-looking keys', () => {
    expect(
      redactAttributes({
        authorization: 'Bearer secret-token',
        'set-cookie': 'session=abc',
        client_secret: 'sk_live_123',
        'x-api-key': 'key_123',
        access_token: 'at_123',
      }),
    ).toEqual({
      authorization: '[redacted]',
      'set-cookie': '[redacted]',
      client_secret: '[redacted]',
      'x-api-key': '[redacted]',
      access_token: '[redacted]',
    })
  })

  it('keeps opaque ids and benign fields, and does not clobber token_count', () => {
    expect(
      redactAttributes({
        'om.tenant_id': '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        'http.route': '/api/orders',
        token_count: 42,
        'http.response.status_code': 500,
      }),
    ).toEqual({
      'om.tenant_id': '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      'http.route': '/api/orders',
      token_count: 42,
      'http.response.status_code': 500,
    })
  })

  it('runs redactPii over non-secret string values (inline email)', () => {
    expect(redactAttributes({ note: 'contact jan@example.com', module: 'orders' })).toEqual({
      note: 'contact [redacted-email]',
      module: 'orders',
    })
  })
})
