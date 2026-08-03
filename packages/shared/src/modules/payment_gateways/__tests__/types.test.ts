import {
  clearWebhookHandlers,
  getWebhookHandler,
  registerWebhookHandler,
  type VerifyWebhookInput,
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
})
