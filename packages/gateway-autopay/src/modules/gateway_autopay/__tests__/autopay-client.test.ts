import { computeAutopayHash } from '../lib/hash'
import { buildSessionRequest, resolveApiHost, sanitizeOrderId, AutopayApiError, type AutopayCredentials } from '../lib/autopay-client'

const credentials: AutopayCredentials = {
  serviceId: '2',
  sharedKey: '2test2',
  gatewayUrl: 'https://testpay.autopay.eu/sciezka',
}

describe('resolveApiHost', () => {
  it('accepts the documented sandbox host', () => {
    expect(resolveApiHost('https://testpay.autopay.eu/anything')).toBe('https://testpay.autopay.eu')
  })

  it('accepts the documented production host', () => {
    expect(resolveApiHost('https://pay.autopay.eu/anything')).toBe('https://pay.autopay.eu')
  })

  it('rejects an unrecognized host rather than silently trusting it', () => {
    expect(() => resolveApiHost('https://not-autopay.example.com/x')).toThrow(AutopayApiError)
  })
})

describe('sanitizeOrderId', () => {
  it('strips dashes from a UUID down to exactly 32 chars (the Autopay OrderID limit)', () => {
    const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
    const orderId = sanitizeOrderId(uuid)
    expect(orderId).toHaveLength(32)
    expect(orderId).toBe('3fa85f6457174562b3fc2c963f66afa6'.slice(0, 32))
  })

  it('drops characters outside the documented alnum + "-_" charset', () => {
    expect(sanitizeOrderId('order#1 with spaces!')).toBe('order1withspaces')
  })
})

describe('buildSessionRequest', () => {
  it('signs exactly the confirmed field order and drops absent optional fields', () => {
    const result = buildSessionRequest({
      credentials,
      orderId: '100',
      amount: '1.50',
      customerEmail: 'buyer@example.com',
    })

    const expectedHash = computeAutopayHash(['2', '100', '1.50', 'buyer@example.com'], '2test2')
    expect(result.fields.Hash).toBe(expectedHash)
    expect(result.fields.ServiceID).toBe('2')
    expect(result.fields.OrderID).toBe('100')
    expect(result.fields.Amount).toBe('1.50')
    expect(result.fields.CustomerEmail).toBe('buyer@example.com')
    expect(result.fields.Description).toBeUndefined()
    expect(result.fields.GatewayID).toBeUndefined()
    expect(result.formPost.url).toBe(credentials.gatewayUrl)
    expect(result.formPost.method).toBe('POST')
    expect(result.redirectUrl.startsWith(`${credentials.gatewayUrl}?`)).toBe(true)
  })

  it('includes optional fields in the confirmed ascending order when provided', () => {
    const result = buildSessionRequest({
      credentials,
      orderId: '100',
      amount: '1.50',
      description: 'Order #100',
      gatewayId: '3',
      currencyCode: 'PLN',
      customerEmail: 'buyer@example.com',
    })

    const expectedHash = computeAutopayHash(
      ['2', '100', '1.50', 'Order #100', '3', 'PLN', 'buyer@example.com'],
      '2test2',
    )
    expect(result.fields.Hash).toBe(expectedHash)
  })
})
