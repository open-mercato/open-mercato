import {
  TPAY_BASE_URLS,
  TpayClientError,
  assertTpayPaymentUrl,
  createTransaction,
  getTransaction,
  requestAccessToken,
  resolveTpayEnvironment,
} from '../lib/tpay-client'

const SECRET = 'super-secret-value'
const TOKEN = 'bearer-token-value'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('tpay client', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('resolves environments strictly', () => {
    expect(resolveTpayEnvironment('sandbox')).toBe('sandbox')
    expect(resolveTpayEnvironment('production')).toBe('production')
    expect(() => resolveTpayEnvironment('staging')).toThrow(TpayClientError)
    expect(() => resolveTpayEnvironment(undefined)).toThrow(TpayClientError)
  })

  it('posts form-encoded credentials to the environment base url', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: TOKEN, expires_in: 7200 }))
    const token = await requestAccessToken({ clientId: 'id-1', clientSecret: SECRET, environment: 'sandbox' })
    expect(token).toBe(TOKEN)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${TPAY_BASE_URLS.sandbox}/oauth/auth`)
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded')
    const params = new URLSearchParams(init.body)
    expect(params.get('client_id')).toBe('id-1')
    expect(params.get('client_secret')).toBe(SECRET)
    expect(init.signal).toBeDefined()
  })

  it('uses the production base url', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: TOKEN }))
    await requestAccessToken({ clientId: 'a', clientSecret: 'b', environment: 'production' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.tpay.com/oauth/auth')
  })

  it('maps oauth failure without leaking secrets', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: 'failed', errors: [{ errorMessage: SECRET }] }, 401))
    const error = await requestAccessToken({ clientId: 'a', clientSecret: SECRET, environment: 'sandbox' }).catch(
      (e) => e,
    )
    expect(error).toBeInstanceOf(TpayClientError)
    expect(error.status).toBe(401)
    expect(error.message).not.toContain(SECRET)
  })

  it('rejects an oauth response without an access token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token_type: 'Bearer' }))
    await expect(
      requestAccessToken({ clientId: 'a', clientSecret: 'b', environment: 'sandbox' }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('creates a transaction with a bearer header and json body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ transactionId: 'tr-1', title: 'TR1', status: 'pending', transactionPaymentUrl: 'https://secure.tpay.com/x' }),
    )
    const result = await createTransaction(TOKEN, 'sandbox', {
      amount: 12.34,
      currency: 'PLN',
      description: 'Order',
      payer: { email: 'a@b.pl', name: 'Jan' },
    })
    expect(result.transactionId).toBe('tr-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${TPAY_BASE_URLS.sandbox}/transactions`)
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body).amount).toBe(12.34)
  })

  it('reads a transaction with an encoded id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ transactionId: 'a/b', status: 'paid', payments: { amountPaid: 5 } }))
    const result = await getTransaction(TOKEN, 'production', 'a/b')
    expect(result.payments?.amountPaid).toBe(5)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.tpay.com/transactions/a%2Fb')
    expect(init.method).toBe('GET')
  })

  it.each([400, 404, 500, 503])('maps http %i to a typed error', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ result: 'failed', errors: [{ errorMessage: 'payer@example.com' }] }, status))
    const error = await getTransaction(TOKEN, 'sandbox', 'x').catch((e) => e)
    expect(error).toBeInstanceOf(TpayClientError)
    expect(error.status).toBe(status)
    expect(error.message).not.toContain('payer@example.com')
    expect(error.message).not.toContain(TOKEN)
  })

  it('maps abort and timeout to a timeout error', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    fetchMock.mockRejectedValue(timeout)
    await expect(getTransaction(TOKEN, 'sandbox', 'x')).rejects.toMatchObject({ code: 'timeout' })
  })

  it('maps network failures without echoing the cause', async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed ${TOKEN}`))
    const error = await getTransaction(TOKEN, 'sandbox', 'x').catch((e) => e)
    expect(error.code).toBe('network')
    expect(error.message).not.toContain(TOKEN)
  })

  it('fails when the body exceeds 256 KiB', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(256 * 1024 + 1), { status: 200 }))
    await expect(getTransaction(TOKEN, 'sandbox', 'x')).rejects.toMatchObject({ code: 'oversized' })
  })

  it('fails on an oversized declared content-length', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-length': '999999' } }))
    await expect(getTransaction(TOKEN, 'sandbox', 'x')).rejects.toMatchObject({ code: 'oversized' })
  })

  it('fails on malformed json', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))
    await expect(getTransaction(TOKEN, 'sandbox', 'x')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('fails on an unexpected field type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ transactionId: 'x', amount: 'ten' }))
    await expect(getTransaction(TOKEN, 'sandbox', 'x')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  describe('assertTpayPaymentUrl', () => {
    it('accepts https tpay hosts', () => {
      expect(assertTpayPaymentUrl('https://secure.tpay.com/?id=1', 'production').hostname).toBe('secure.tpay.com')
      expect(assertTpayPaymentUrl('https://tpay.com/pay', 'sandbox').hostname).toBe('tpay.com')
    })

    it.each([
      'http://secure.tpay.com/x',
      'https://evil.com/x',
      'https://tpay.com.evil.com/x',
      'https://eviltpay.com/x',
      'https://user:pw@secure.tpay.com/x',
      'javascript:alert(1)',
      'not a url',
    ])('rejects %s', (url) => {
      expect(() => assertTpayPaymentUrl(url, 'production')).toThrow(TpayClientError)
    })
  })
})
