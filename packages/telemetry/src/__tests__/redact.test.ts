import { redactPii, redactAttributes, redactUrl, redactSpanName } from '../facade/redact'

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

  it('handles hostile runs of email punctuation without pathological matching', () => {
    const hostile = `${'%'.repeat(100_000)} not-an-email`

    expect(redactPii(hostile)).toBe(hostile)
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
        token: 'generic-token',
      }),
    ).toEqual({
      authorization: '[redacted]',
      'set-cookie': '[redacted]',
      client_secret: '[redacted]',
      'x-api-key': '[redacted]',
      access_token: '[redacted]',
      token: '[redacted]',
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


describe('URL redaction', () => {
  const token = 'a'.repeat(64)
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

  it.each(['token', 'code', 'search'])('masks every %s query value and preserves keys', (key) => {
    expect(redactUrl(`/callback?${key}=one-time-secret&page=2&${key}=again`)).toBe(
      `/callback?${key}=[redacted]&page=[redacted]&${key}=[redacted]`,
    )
  })

  it('masks reset tokens and preserves UUID path segments', () => {
    expect(redactUrl(`/reset/${token}`)).toBe('/reset/[redacted]')
    expect(redactUrl(`/records/${uuid}`)).toBe(`/records/${uuid}`)
    expect(redactUrl(`/reset/${'A_-b'.repeat(8)}`)).toBe('/reset/[redacted]')
    expect(redactUrl(`/reset/${'a'.repeat(31)}`)).toBe(`/reset/${'a'.repeat(31)}`)
  })

  it('handles absolute, relative, encoded and malformed URLs without retaining values', () => {
    expect(redactUrl(`https://example.com/reset/${token}?token=a%26b&flag#secret`)).toBe(
      'https://example.com/reset/[redacted]?token=[redacted]&flag#[redacted]',
    )
    expect(redactUrl(`/reset/${'%61'.repeat(32)}`)).toBe('/reset/[redacted]')
    expect(redactUrl('/reset/%broken?token=secret')).toBe('/reset/[redacted]?token=[redacted]')
    expect(redactUrl('/api/customers')).toBe('/api/customers')
    expect(redactUrl('')).toBe('')
  })

  it('cleans URL-bearing span names while preserving operation names', () => {
    expect(redactSpanName(`fetch GET https://example.com/reset/${token}?code=secret`)).toBe(
      'fetch GET https://example.com/reset/[redacted]?code=[redacted]',
    )
    expect(redactSpanName(`GET /reset/${token}?token=secret`)).toBe('GET /reset/[redacted]?token=[redacted]')
    expect(redactSpanName('customers.person.updated')).toBe('customers.person.updated')
  })

  it('cleans each URL attribute including the standalone query convention', () => {
    expect(redactAttributes({
      'http.target': `/reset/${token}?token=secret`,
      'http.url': 'https://example.com/callback?code=secret',
      'url.full': 'https://example.com/portal?token=secret',
      'url.path': `/reset/${token}`,
      'url.query': 'token=secret&search=private&page=2',
    })).toEqual({
      'http.target': '/reset/[redacted]?token=[redacted]',
      'http.url': 'https://example.com/callback?code=[redacted]',
      'url.full': 'https://example.com/portal?token=[redacted]',
      'url.path': '/reset/[redacted]',
      'url.query': 'token=[redacted]&search=[redacted]&page=[redacted]',
    })
  })
})
