import { redactEmails, redactForStorage, REDACTED_EMAIL } from '../redact'

describe('redactEmails', () => {
  // The exact shape an SMTP rejection quotes, which is how an address reached storage at all.
  test('removes an address from a transport rejection', () => {
    expect(redactEmails('550 5.1.1 <someone@example.com>: Recipient address rejected'))
      .toBe(`550 5.1.1 <${REDACTED_EMAIL}>: Recipient address rejected`)
  })

  test('removes every address, not just the first', () => {
    expect(redactEmails('a@x.com and b@y.co.uk failed')).toBe(`${REDACTED_EMAIL} and ${REDACTED_EMAIL} failed`)
  })

  test.each([
    'first.last+tag@sub.domain.example',
    'UPPER@EXAMPLE.COM',
    'digits123@example.io',
    'dash-name@my-domain.com',
  ])('catches %s', (address) => {
    expect(redactEmails(`rejected ${address}`)).not.toContain(address)
  })

  test('leaves text with no address alone', () => {
    expect(redactEmails('connection reset by peer')).toBe('connection reset by peer')
  })

  test('does not mistake a version or a path for an address', () => {
    expect(redactEmails('smtp@2 failed at /var/log/mail')).toBe('smtp@2 failed at /var/log/mail')
  })
})

describe('redactForStorage', () => {
  test('redacts before truncating, so a trim cannot reveal what redaction removed', () => {
    const long = `${'x'.repeat(30)} someone@example.com ${'y'.repeat(200)}`
    const stored = redactForStorage(long, 60)
    expect(stored).not.toContain('someone@example.com')
    expect(stored.length).toBeLessThanOrEqual(60)
  })

  test('truncates to the limit', () => {
    expect(redactForStorage('z'.repeat(5000), 2000)).toHaveLength(2000)
  })
})
