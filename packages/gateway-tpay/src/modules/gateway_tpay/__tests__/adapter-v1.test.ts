import type { CreateSessionInput } from '@open-mercato/shared/modules/payment_gateways/types'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { tpayAdapterV1 } from '../lib/adapters/v1'
import { TPAY_BASE_URLS } from '../lib/tpay-client'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => `translated:${key}` }),
}))

const CLIENT_SECRET = 'client-secret-value'
const TOKEN = 'oauth-token-value'
const PAYER_EMAIL = 'jan.kowalski@example.com'
const PAYER_NAME = 'Jan Kowalski'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function baseInput(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  return {
    paymentId: 'payment-123',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    amount: 123.45,
    currencyCode: 'PLN',
    description: 'Order #42',
    successUrl: 'https://shop.example.com/pay/success',
    cancelUrl: 'https://shop.example.com/pay/cancel',
    metadata: { customerEmail: PAYER_EMAIL, customerName: PAYER_NAME },
    credentials: { clientId: 'client-id', clientSecret: CLIENT_SECRET, environment: 'sandbox' },
    ...overrides,
  }
}

function mockCreateFlow(fetchMock: jest.Mock, transaction: Record<string, unknown>): void {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ access_token: TOKEN }))
    .mockResolvedValueOnce(jsonResponse(transaction))
}

const CREATED_TRANSACTION = {
  result: 'success',
  transactionId: 'ta_abc123',
  title: 'TR-ABC-123',
  status: 'pending',
  transactionPaymentUrl: 'https://secure.sandbox.tpay.com/?title=TR-ABC-123',
}

describe('tpayAdapterV1', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('exposes the tpay provider key', () => {
    expect(tpayAdapterV1.providerKey).toBe('tpay')
  })

  describe('createSession', () => {
    it('sends the pinned hosted transaction body and returns a redirect session', async () => {
      mockCreateFlow(fetchMock, CREATED_TRANSACTION)
      const result = await tpayAdapterV1.createSession(baseInput())

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0][0]).toBe(`${TPAY_BASE_URLS.sandbox}/oauth/auth`)
      const [url, init] = fetchMock.mock.calls[1]
      expect(url).toBe(`${TPAY_BASE_URLS.sandbox}/transactions`)
      expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`)
      expect(JSON.parse(init.body)).toEqual({
        amount: 123.45,
        currency: 'PLN',
        description: 'Order #42',
        hiddenDescription: 'payment-123',
        lang: 'pl',
        payer: { email: PAYER_EMAIL, name: PAYER_NAME },
        callbacks: {
          payerUrls: {
            success: 'https://shop.example.com/pay/success',
            error: 'https://shop.example.com/pay/cancel',
          },
        },
      })
      expect(JSON.parse(init.body)).not.toHaveProperty('pay')

      expect(result).toEqual({
        sessionId: 'ta_abc123',
        status: 'pending',
        redirectUrl: 'https://secure.sandbox.tpay.com/?title=TR-ABC-123',
        clientSession: { type: 'redirect', redirectUrl: 'https://secure.sandbox.tpay.com/?title=TR-ABC-123' },
        providerData: { title: 'TR-ABC-123', providerStatus: 'pending' },
      })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(PAYER_EMAIL)
      expect(serialized).not.toContain(PAYER_NAME)
      expect(serialized).not.toContain(CLIENT_SECRET)
      expect(serialized).not.toContain(TOKEN)
    })

    it('includes a validated notification url and uses the production base url', async () => {
      mockCreateFlow(fetchMock, { ...CREATED_TRANSACTION, transactionPaymentUrl: 'https://secure.tpay.com/?t=1' })
      await tpayAdapterV1.createSession(
        baseInput({
          successUrl: undefined,
          cancelUrl: undefined,
          description: undefined,
          amount: 10.005,
          credentials: {
            clientId: 'client-id',
            clientSecret: CLIENT_SECRET,
            environment: 'production',
            notificationUrl: 'https://shop.example.com/api/tpay/notify',
          },
        }),
      )
      const [url, init] = fetchMock.mock.calls[1]
      expect(url).toBe('https://api.tpay.com/transactions')
      expect(JSON.parse(init.body)).toEqual({
        amount: 10.01,
        currency: 'PLN',
        description: 'translated:gateway_tpay.description.fallback',
        hiddenDescription: 'payment-123',
        lang: 'pl',
        payer: { email: PAYER_EMAIL, name: PAYER_NAME },
        callbacks: { notification: { url: 'https://shop.example.com/api/tpay/notify' } },
      })
    })

    it('omits callbacks entirely when no urls are available', async () => {
      mockCreateFlow(fetchMock, CREATED_TRANSACTION)
      await tpayAdapterV1.createSession(baseInput({ successUrl: undefined, cancelUrl: undefined }))
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('callbacks')
    })

    it.each([
      ['non-PLN currency', { currencyCode: 'EUR' }, 'currencyNotSupported'],
      ['zero amount', { amount: 0 }, 'invalidAmount'],
      ['negative amount', { amount: -5 }, 'invalidAmount'],
      ['non-finite amount', { amount: Number.NaN }, 'invalidAmount'],
      ['missing email', { metadata: { customerName: PAYER_NAME } }, 'payerEmailRequired'],
      ['invalid email', { metadata: { customerEmail: 'nope', customerName: PAYER_NAME } }, 'payerEmailRequired'],
      ['missing name', { metadata: { customerEmail: PAYER_EMAIL } }, 'payerNameRequired'],
      ['blank name', { metadata: { customerEmail: PAYER_EMAIL, customerName: '   ' } }, 'payerNameRequired'],
      [
        'overlong name',
        { metadata: { customerEmail: PAYER_EMAIL, customerName: 'x'.repeat(256) } },
        'payerNameRequired',
      ],
      [
        'invalid notification url',
        {
          credentials: {
            clientId: 'client-id',
            clientSecret: CLIENT_SECRET,
            environment: 'production',
            notificationUrl: 'http://shop.example.com/notify',
          },
        },
        'invalidNotificationUrl',
      ],
    ] as Array<[string, Partial<CreateSessionInput>, string]>)(
      'rejects %s with 422 before any provider call',
      async (_label, overrides, key) => {
        const error = await tpayAdapterV1.createSession(baseInput(overrides)).catch((caught: unknown) => caught)
        expect(error).toMatchObject({
          status: 422,
          body: { error: `translated:gateway_tpay.errors.${key}`, code: `gateway_tpay.errors.${key}` },
        })
        expect(JSON.stringify(error)).not.toContain(PAYER_EMAIL)
        expect(fetchMock).not.toHaveBeenCalled()
      },
    )

    it('rejects a payment url outside tpay hosts', async () => {
      mockCreateFlow(fetchMock, { ...CREATED_TRANSACTION, transactionPaymentUrl: 'https://evil.example.com/pay' })
      await expect(tpayAdapterV1.createSession(baseInput())).rejects.toMatchObject({
        status: 502,
        body: { code: 'gateway_tpay.errors.providerUnavailable' },
      })
    })

    it.each([
      ['transaction id', { ...CREATED_TRANSACTION, transactionId: undefined }],
      ['payment url', { ...CREATED_TRANSACTION, transactionPaymentUrl: undefined }],
    ])('fails when the provider omits the %s', async (_label, transaction) => {
      mockCreateFlow(fetchMock, transaction)
      await expect(tpayAdapterV1.createSession(baseInput())).rejects.toMatchObject({ status: 502 })
    })

    it('maps provider failures to a bounded 502 without leaking the provider body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: TOKEN }))
      fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ errorMessage: CLIENT_SECRET }] }, 400))
      const error = await tpayAdapterV1.createSession(baseInput()).catch((caught: unknown) => caught)
      expect(error).toMatchObject({
        status: 502,
        body: { error: 'translated:gateway_tpay.errors.providerUnavailable' },
      })
      expect(JSON.stringify(error)).not.toContain(CLIENT_SECRET)
      expect((error as Error).message).not.toContain(CLIENT_SECRET)
    })

    it('maps oauth failure to 502', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 401))
      await expect(tpayAdapterV1.createSession(baseInput())).rejects.toMatchObject({ status: 502 })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reports provider failures through the telemetry runtime', async () => {
      const reportError = jest.fn()
      const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
      try {
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 401))
        await expect(tpayAdapterV1.createSession(baseInput())).rejects.toMatchObject({ status: 502 })
        expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
          module: 'gateway_tpay',
          code: 'gateway_tpay.provider_failed',
        })
      } finally {
        unregister()
      }
    })
  })

  describe('getStatus', () => {
    it('maps the transaction status and paid amount', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: TOKEN }))
        .mockResolvedValueOnce(
          jsonResponse({
            transactionId: 'ta_abc123',
            status: 'correct',
            amount: '123.45',
            currency: 'PLN',
            payments: { amountPaid: 123.45 },
          }),
        )
      const result = await tpayAdapterV1.getStatus({
        sessionId: 'ta_abc123',
        credentials: { clientId: 'client-id', clientSecret: CLIENT_SECRET, environment: 'sandbox' },
      })
      expect(fetchMock.mock.calls[1][0]).toBe(`${TPAY_BASE_URLS.sandbox}/transactions/ta_abc123`)
      expect(result).toEqual({
        status: 'captured',
        amount: 123.45,
        amountReceived: 123.45,
        currencyCode: 'PLN',
        providerData: { providerStatus: 'correct' },
      })
    })

    it('defaults amount received to zero and maps unknown statuses', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ access_token: TOKEN }))
        .mockResolvedValueOnce(jsonResponse({ transactionId: 'ta_1', status: 'mystery', amount: 10, currency: 'PLN' }))
      const result = await tpayAdapterV1.getStatus({
        sessionId: 'ta_1',
        credentials: { clientId: 'client-id', clientSecret: CLIENT_SECRET, environment: 'sandbox' },
      })
      expect(result.status).toBe('unknown')
      expect(result.amountReceived).toBe(0)
    })

    it('maps provider failures to 502', async () => {
      fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
      await expect(
        tpayAdapterV1.getStatus({
          sessionId: 'ta_1',
          credentials: { clientId: 'client-id', clientSecret: CLIENT_SECRET, environment: 'sandbox' },
        }),
      ).rejects.toMatchObject({ status: 502 })
    })
  })

  it('delegates mapStatus to the status map', () => {
    expect(tpayAdapterV1.mapStatus('paid')).toBe('captured')
    expect(tpayAdapterV1.mapStatus('weird')).toBe('unknown')
  })

  it.each(['capture', 'refund', 'cancel'] as const)('rejects %s as unsupported without provider calls', async (member) => {
    const input = { sessionId: 'ta_1', credentials: {} }
    await expect(tpayAdapterV1[member](input)).rejects.toMatchObject({
      status: 422,
      body: {
        error: 'translated:gateway_tpay.errors.unsupportedOperation',
        code: 'gateway_tpay.errors.unsupportedOperation',
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects webhook verification as unsupported', async () => {
    await expect(
      tpayAdapterV1.verifyWebhook({ rawBody: '{}', headers: {}, credentials: {} }),
    ).rejects.toThrow('[internal] Tpay notifications are not supported yet')
  })
})
