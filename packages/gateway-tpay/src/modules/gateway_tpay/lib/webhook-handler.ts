import type {
  VerifyWebhookInput,
  WebhookEvent,
  WebhookLocatorContext,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { computeTpayMd5, verifyTpayMd5 } from './checksum'
import { verifyTpayJws } from './jws'
import {
  parseTpayNotificationForm,
  TPAY_CRC_PATTERN,
  TpayNotificationError,
  type TpayNotification,
} from './notification-form'
import { resolveTpayEnvironment } from './tpay-client'

export const TPAY_JWS_HEADER = 'x-jws-signature'
export const TPAY_WEBHOOK_MAX_BODY_BYTES = 64 * 1024

const STORED_AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,4}))?$/

export type TpayNotificationVerifyOptions = {
  now?: () => Date
}

function readSecurityCode(credentials: Record<string, unknown>): string {
  const value = credentials.notificationSecurityCode
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TpayNotificationError('missingSecurityCode')
  }
  return value.trim()
}

function readSignatureHeader(headers: VerifyWebhookInput['headers']): string {
  const value = headers[TPAY_JWS_HEADER]
  if (typeof value !== 'string' || value.trim().length === 0) throw new TpayNotificationError('missingSignature')
  return value
}

function storedAmountToGrosze(amount: string): number {
  const match = STORED_AMOUNT_PATTERN.exec(amount.trim())
  if (!match) throw new TpayNotificationError('amountMismatch')
  const fraction = (match[2] ?? '').padEnd(4, '0')
  if (fraction.slice(2) !== '00') throw new TpayNotificationError('amountMismatch')
  const grosze = Number(match[1]) * 100 + Number(fraction.slice(0, 2))
  if (!Number.isSafeInteger(grosze)) throw new TpayNotificationError('amountMismatch')
  return grosze
}

function assertAmounts(notification: TpayNotification, candidateAmount: string): number {
  if (notification.trAmountGrosze !== storedAmountToGrosze(candidateAmount)) {
    throw new TpayNotificationError('amountMismatch')
  }
  if (notification.trStatus !== 'true') return 0
  if (notification.trPaidGrosze < notification.trAmountGrosze) throw new TpayNotificationError('underpaid')
  return notification.trPaidGrosze - notification.trAmountGrosze
}

export async function verifyTpayNotification(
  input: VerifyWebhookInput,
  options: TpayNotificationVerifyOptions = {},
): Promise<WebhookEvent> {
  if (!Buffer.isBuffer(input.rawBody)) throw new TpayNotificationError('unsupportedBody')
  const rawBody = input.rawBody
  const notification = parseTpayNotificationForm(rawBody)
  const environment = resolveTpayEnvironment(input.credentials.environment ?? 'sandbox')
  const securityCode = readSecurityCode(input.credentials)
  const candidate = input.candidate
  if (!candidate) throw new TpayNotificationError('missingCandidate')
  if (candidate.paymentId.toLowerCase() !== notification.trCrc.toLowerCase()) {
    throw new TpayNotificationError('paymentMismatch')
  }

  const expectedMd5 = computeTpayMd5({
    id: notification.id,
    trId: notification.trId,
    trAmount: notification.trAmount,
    trCrc: notification.trCrc,
    securityCode,
  })
  if (!verifyTpayMd5(expectedMd5, notification.md5sum)) throw new TpayNotificationError('checksumMismatch')

  await verifyTpayJws({ header: readSignatureHeader(input.headers), rawBody, environment })

  if (candidate.currencyCode.trim().toUpperCase() !== 'PLN') throw new TpayNotificationError('currencyMismatch')
  const overpaidByGrosze = assertAmounts(notification, candidate.amount)

  const settled = notification.trStatus === 'true'
  const identity = `${notification.trId}:${notification.trStatus}:${notification.trDate}`
  const data: Record<string, unknown> = {
    status: settled ? 'correct' : 'refund',
    title: notification.trId,
    trDate: notification.trDate,
    paid: notification.trPaid,
    amount: notification.trAmount,
    testMode: notification.testMode === '1',
  }
  if (overpaidByGrosze > 0) data.overpaidByGrosze = overpaidByGrosze

  return {
    eventType: settled ? 'tpay.transaction.settled' : 'tpay.transaction.chargeback',
    eventId: identity,
    idempotencyKey: `tpay:transaction:${identity}`,
    data,
    timestamp: (options.now ?? (() => new Date()))(),
  }
}

export function readTpayPaymentIdHint(
  _payload: Record<string, unknown> | null,
  context?: WebhookLocatorContext,
): string | null {
  try {
    const rawBody = context?.rawBody
    if (rawBody === undefined) return null
    const text = Buffer.isBuffer(rawBody)
      ? new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
      : rawBody
    const values = new URLSearchParams(text).getAll('tr_crc')
    if (values.length !== 1 || !TPAY_CRC_PATTERN.test(values[0])) return null
    return values[0]
  } catch {
    return null
  }
}
