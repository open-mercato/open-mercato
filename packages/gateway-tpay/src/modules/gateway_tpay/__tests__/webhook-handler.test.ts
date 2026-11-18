import {
  WebhookVerificationUnavailableError,
  type VerifyWebhookInput,
  type WebhookCandidateSnapshot,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { computeTpayMd5 } from '../lib/checksum'
import { TpayJwsError, verifyTpayJws } from '../lib/jws'
import { verifyTpayNotification } from '../lib/webhook-handler'

jest.mock('../lib/jws', () => {
  const actual = jest.requireActual('../lib/jws')
  return { ...actual, verifyTpayJws: jest.fn() }
})

const verifyJwsMock = verifyTpayJws as jest.MockedFunction<typeof verifyTpayJws>

const CRC = '3f1b6a52-8c0e-4f6a-9d2b-1a2b3c4d5e6f'
const SECURITY_CODE = 'security-code'
const JWS = 'header..signature'
const NOW = new Date('2026-10-09T12:00:00.000Z')
const PAYER_EMAIL = 'buyer@example.com'
const DESCRIPTION = 'Order 1 for Jan'

type Fields = Record<string, string>

function fields(overrides: Fields = {}): Fields {
  const base: Fields = {
    id: '12345',
    tr_id: 'TR-0001',
    tr_date: '2026-10-09 12:00:00',
    tr_crc: CRC,
    tr_amount: '12.34',
    tr_paid: '12.34',
    tr_desc: DESCRIPTION,
    tr_status: 'TRUE',
    tr_error: 'none',
    tr_email: PAYER_EMAIL,
    test_mode: '1',
    ...overrides,
  }
  base.md5sum = overrides.md5sum ?? computeTpayMd5({
    id: base.id,
    trId: base.tr_id,
    trAmount: base.tr_amount,
    trCrc: base.tr_crc,
    securityCode: SECURITY_CODE,
  })
  return base
}

function body(values: Fields): Buffer {
  return Buffer.from(new URLSearchParams(values).toString(), 'utf8')
}

function candidate(overrides: Partial<WebhookCandidateSnapshot> = {}): WebhookCandidateSnapshot {
  return {
    transactionId: 'tx-1',
    paymentId: CRC,
    providerSessionId: 'ta_1',
    amount: '12.3400',
    currencyCode: 'PLN',
    ...overrides,
  }
}

function input(overrides: Partial<VerifyWebhookInput> = {}, values: Fields = fields()): VerifyWebhookInput {
  return {
    rawBody: body(values),
    headers: { 'x-jws-signature': JWS },
    credentials: { environment: 'sandbox', notificationSecurityCode: SECURITY_CODE },
    candidate: candidate(),
    ...overrides,
  }
}

function verify(value: VerifyWebhookInput) {
  return verifyTpayNotification(value, { now: () => NOW })
}

describe('verifyTpayNotification', () => {
  beforeEach(() => {
    verifyJwsMock.mockReset()
    verifyJwsMock.mockResolvedValue(undefined)
  })

  it('returns a settled event for a verified correct notification', async () => {
    const value = input()
    const event = await verify(value)
    expect(event).toEqual({
      eventType: 'tpay.transaction.settled',
      eventId: 'TR-0001:true:2026-10-09 12:00:00',
      idempotencyKey: 'tpay:transaction:TR-0001:true:2026-10-09 12:00:00',
      data: {
        status: 'correct',
        title: 'TR-0001',
        trDate: '2026-10-09 12:00:00',
        paid: '12.34',
        amount: '12.34',
        testMode: true,
      },
      timestamp: NOW,
    })
    expect(verifyJwsMock).toHaveBeenCalledWith({ header: JWS, rawBody: value.rawBody, environment: 'sandbox' })
  })

  it('returns a chargeback event mapped to refund', async () => {
    const event = await verify(input({}, fields({ tr_status: 'CHARGEBACK', tr_paid: '0.00' })))
    expect(event.eventType).toBe('tpay.transaction.chargeback')
    expect(event.data.status).toBe('refund')
    expect(event.idempotencyKey).toBe('tpay:transaction:TR-0001:chargeback:2026-10-09 12:00:00')
  })

  it('uses the production environment from credentials', async () => {
    await verify(input({ credentials: { environment: 'production', notificationSecurityCode: SECURITY_CODE } }))
    expect(verifyJwsMock).toHaveBeenCalledWith(expect.objectContaining({ environment: 'production' }))
  })

  it('produces a deterministic identity for duplicate deliveries', async () => {
    const first = await verifyTpayNotification(input(), { now: () => new Date(1) })
    const second = await verifyTpayNotification(input(), { now: () => new Date(2) })
    expect(second.eventId).toBe(first.eventId)
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
  })

  it('keeps payer data, description and evidence out of event data', async () => {
    const event = await verify(input())
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain(PAYER_EMAIL)
    expect(serialized).not.toContain(DESCRIPTION)
    expect(serialized).not.toContain(fields().md5sum)
    expect(serialized).not.toContain(JWS)
    expect(Object.keys(event.data)).not.toEqual(expect.arrayContaining(['tr_email', 'tr_desc', 'md5sum']))
  })

  it('rejects a string raw body', async () => {
    await expect(verify(input({ rawBody: 'id=1' }))).rejects.toMatchObject({ reason: 'unsupportedBody' })
  })

  it('rejects a checksum mismatch before checking the signature', async () => {
    const values = fields({ md5sum: '0'.repeat(32) })
    await expect(verify(input({}, values))).rejects.toMatchObject({ reason: 'checksumMismatch' })
    expect(verifyJwsMock).not.toHaveBeenCalled()
  })

  it('rejects a checksum computed with another security code', async () => {
    const values = fields()
    await expect(
      verify(input({ credentials: { environment: 'sandbox', notificationSecurityCode: 'other' } }, values)),
    ).rejects.toMatchObject({ reason: 'checksumMismatch' })
  })

  it('rejects an invalid signature', async () => {
    verifyJwsMock.mockRejectedValue(new TpayJwsError('signatureMismatch'))
    await expect(verify(input())).rejects.toBeInstanceOf(TpayJwsError)
  })

  it('rejects a missing signature header', async () => {
    await expect(verify(input({ headers: {} }))).rejects.toMatchObject({ reason: 'missingSignature' })
  })

  it('propagates verification unavailability', async () => {
    verifyJwsMock.mockRejectedValue(new WebhookVerificationUnavailableError('[internal] down'))
    await expect(verify(input())).rejects.toBeInstanceOf(WebhookVerificationUnavailableError)
  })

  it.each([undefined, '', '   ', 42])('rejects a missing security code (%p)', async (code) => {
    await expect(
      verify(input({ credentials: { environment: 'sandbox', notificationSecurityCode: code } })),
    ).rejects.toMatchObject({ reason: 'missingSecurityCode' })
    expect(verifyJwsMock).not.toHaveBeenCalled()
  })

  it('rejects a missing candidate', async () => {
    await expect(verify(input({ candidate: undefined }))).rejects.toMatchObject({ reason: 'missingCandidate' })
  })

  it('rejects a candidate for another payment', async () => {
    await expect(
      verify(input({ candidate: candidate({ paymentId: '00000000-0000-4000-8000-000000000000' }) })),
    ).rejects.toMatchObject({ reason: 'paymentMismatch' })
    expect(verifyJwsMock).not.toHaveBeenCalled()
  })

  it('matches the payment id case-insensitively', async () => {
    await expect(verify(input({ candidate: candidate({ paymentId: CRC.toUpperCase() }) }))).resolves.toBeDefined()
  })

  it.each(['12.35', '12.3450', 'abc', '12.34567'])('rejects a stored amount mismatch (%s)', async (amount) => {
    await expect(verify(input({ candidate: candidate({ amount }) }))).rejects.toMatchObject({
      reason: 'amountMismatch',
    })
  })

  it.each(['12.34', '12.340', '12.3400'])('accepts the equivalent stored amount %s', async (amount) => {
    await expect(verify(input({ candidate: candidate({ amount }) }))).resolves.toBeDefined()
  })

  it('rejects an underpayment', async () => {
    await expect(verify(input({}, fields({ tr_paid: '12.33' })))).rejects.toMatchObject({ reason: 'underpaid' })
  })

  it('settles an overpayment and records the surplus', async () => {
    const event = await verify(input({}, fields({ tr_paid: '15.00' })))
    expect(event.eventType).toBe('tpay.transaction.settled')
    expect(event.data.overpaidByGrosze).toBe(266)
  })

  it('rejects a non-PLN candidate', async () => {
    await expect(verify(input({ candidate: candidate({ currencyCode: 'EUR' }) }))).rejects.toMatchObject({
      reason: 'currencyMismatch',
    })
  })

  it('rejects a non-PLN notification currency', async () => {
    await expect(verify(input({}, fields({ tr_currency: 'EUR' })))).rejects.toMatchObject({
      reason: 'invalidCurrency',
    })
  })

  it('accepts an explicit PLN notification currency', async () => {
    await expect(verify(input({}, fields({ tr_currency: 'PLN' })))).resolves.toBeDefined()
  })
})
