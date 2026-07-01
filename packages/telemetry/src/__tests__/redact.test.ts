import { redactPii } from '../facade/redact'

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

  it('leaves opaque ids/UUIDs untouched (we keep those)', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    expect(redactPii(`tenant ${uuid}`)).toBe(`tenant ${uuid}`)
  })

  it('is a no-op for text with no PII', () => {
    expect(redactPii('connection refused')).toBe('connection refused')
  })
})
