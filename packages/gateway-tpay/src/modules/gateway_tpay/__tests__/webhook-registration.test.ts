import { createContainer } from 'awilix'
import {
  clearWebhookHandlers,
  getWebhookHandler,
  type WebhookResponseOutcome,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'
import { readTpayPaymentIdHint } from '../lib/webhook-handler'
import { formatTpayWebhookResponse } from '../lib/webhook-response'

const CRC = '3f1b6a52-8c0e-4f6a-9d2b-1a2b3c4d5e6f'

function context(rawBody: string | Buffer) {
  return { rawBody, headers: {} }
}

describe('formatTpayWebhookResponse', () => {
  it.each<[WebhookResponseOutcome, number, string]>([
    ['accepted', 200, 'TRUE'],
    ['no_candidate', 503, 'FALSE'],
    ['verification_unavailable', 503, 'FALSE'],
    ['processing_failed', 503, 'FALSE'],
    ['verification_failed', 400, 'FALSE'],
    ['payload_too_large', 413, 'FALSE'],
    ['rate_limited', 429, 'FALSE'],
  ])('maps %s to %i %s', (outcome, status, responseBody) => {
    expect(formatTpayWebhookResponse(outcome)).toEqual({
      status,
      body: responseBody,
      contentType: 'text/plain; charset=utf-8',
    })
  })
})

describe('readTpayPaymentIdHint', () => {
  it('returns tr_crc from a valid form body', () => {
    expect(readTpayPaymentIdHint(null, context(Buffer.from(`id=1&tr_crc=${CRC}&tr_id=TR-1`)))).toBe(CRC)
  })

  it.each<[string, string | Buffer | undefined]>([
    ['garbage', Buffer.from('%%%garbage')],
    ['invalid utf-8', Buffer.from([0x74, 0x72, 0x5f, 0xff, 0xfe])],
    ['missing tr_crc', Buffer.from('id=1')],
    ['non-uuid tr_crc', Buffer.from('tr_crc=not-a-uuid')],
    ['duplicate tr_crc', Buffer.from(`tr_crc=${CRC}&tr_crc=${CRC}`)],
    ['no context', undefined],
  ])('returns null for %s', (_label, rawBody) => {
    expect(readTpayPaymentIdHint(null, rawBody === undefined ? undefined : context(rawBody))).toBeNull()
  })
})

describe('gateway_tpay webhook registration', () => {
  afterEach(() => clearWebhookHandlers())

  it('registers the tpay webhook handler with raw bytes, body limit, locator and formatter', () => {
    register(createContainer() as unknown as AppContainer)
    const registration = getWebhookHandler('tpay')
    expect(registration).toBeDefined()
    expect(registration?.rawBody).toBe('bytes')
    expect(registration?.maxBodyBytes).toBe(65536)
    expect(registration?.formatResponse).toBe(formatTpayWebhookResponse)
    expect(registration?.readPaymentIdHint).toBe(readTpayPaymentIdHint)
    expect(registration?.readPaymentIdHint?.(null, context(Buffer.from(`tr_crc=${CRC}`)))).toBe(CRC)
  })

  it('routes the registered handler to notification verification', async () => {
    register(createContainer() as unknown as AppContainer)
    await expect(
      getWebhookHandler('tpay')?.handler({ rawBody: 'x', headers: {}, credentials: {} }),
    ).rejects.toMatchObject({ reason: 'unsupportedBody' })
  })
})
