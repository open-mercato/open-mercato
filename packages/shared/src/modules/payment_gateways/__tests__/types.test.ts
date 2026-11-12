import {
  clearWebhookHandlers,
  getWebhookHandler,
  registerWebhookHandler,
  type VerifyWebhookInput,
  type WebhookLocatorContext,
  type WebhookResponseOutcome,
  WebhookVerificationUnavailableError,
  type WebhookEvent,
} from '../types'

const handler = async (_input: VerifyWebhookInput): Promise<WebhookEvent> => ({
  eventType: 'payment.updated',
  eventId: 'evt-1',
  data: {},
  idempotencyKey: 'evt-1',
  timestamp: new Date(0),
})

describe('payment gateway webhook registration', () => {
  beforeEach(() => {
    clearWebhookHandlers()
  })

  it('preserves an optional valid body limit on the registration', () => {
    registerWebhookHandler('limited', handler, { maxBodyBytes: 64 * 1024 })

    expect(getWebhookHandler('limited')?.maxBodyBytes).toBe(64 * 1024)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects an invalid body limit: %s',
    (maxBodyBytes) => {
      expect(() => registerWebhookHandler('invalid', handler, { maxBodyBytes })).toThrow(
        '[internal] Payment gateway webhook maxBodyBytes must be a positive safe integer',
      )
      expect(getWebhookHandler('invalid')).toBeUndefined()
    },
  )

  it('stays compatible with one-argument locator hints', () => {
    const readSessionIdHint = (payload: Record<string, unknown> | null) => (payload ? 'sess' : null)
    registerWebhookHandler('legacy', handler, { readSessionIdHint })

    expect(getWebhookHandler('legacy')?.readSessionIdHint?.({})).toBe('sess')
    expect(getWebhookHandler('legacy')?.rawBody).toBeUndefined()
    expect(getWebhookHandler('legacy')?.formatResponse).toBeUndefined()
  })

  it('passes through the optional extension hooks', () => {
    const readSessionIdHint = (_payload: Record<string, unknown> | null, context?: WebhookLocatorContext) =>
      context ? String(context.headers['x-id']) : null
    const readPaymentIdHint = () => 'pay'
    const formatResponse = (outcome: WebhookResponseOutcome) => ({ status: 200, body: outcome })
    registerWebhookHandler('extended', handler, {
      readSessionIdHint,
      readPaymentIdHint,
      rawBody: 'bytes',
      formatResponse,
    })

    const registration = getWebhookHandler('extended')
    expect(registration?.rawBody).toBe('bytes')
    expect(registration?.readPaymentIdHint).toBe(readPaymentIdHint)
    expect(registration?.formatResponse).toBe(formatResponse)
    expect(registration?.readSessionIdHint?.(null, { rawBody: '', headers: { 'x-id': 'abc' } })).toBe('abc')
  })

  it('rejects an unknown rawBody mode', () => {
    expect(() =>
      registerWebhookHandler('bad', handler, { rawBody: 'stream' as unknown as 'text' }),
    ).toThrow('[internal] Payment gateway webhook rawBody must be')
    expect(getWebhookHandler('bad')).toBeUndefined()
  })

  it('exposes a typed verification-unavailable error', () => {
    const error = new WebhookVerificationUnavailableError()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('WebhookVerificationUnavailableError')
  })
})
