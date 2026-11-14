export type TpayNotificationErrorReason =
  | 'invalidEncoding'
  | 'missingField'
  | 'duplicateField'
  | 'fieldTooLong'
  | 'invalidChecksumFormat'
  | 'invalidAmount'
  | 'invalidCrc'
  | 'invalidCurrency'
  | 'invalidStatus'
  | 'unsupportedBody'
  | 'missingSecurityCode'
  | 'missingSignature'
  | 'missingCandidate'
  | 'paymentMismatch'
  | 'checksumMismatch'
  | 'currencyMismatch'
  | 'amountMismatch'
  | 'underpaid'

export class TpayNotificationError extends Error {
  readonly reason: TpayNotificationErrorReason

  constructor(reason: TpayNotificationErrorReason) {
    super(`[internal] tpay notification rejected: ${reason}`)
    this.name = 'TpayNotificationError'
    this.reason = reason
  }
}

export type TpayNotificationStatus = 'true' | 'chargeback'

export type TpayNotification = {
  id: string
  trId: string
  trDate: string
  trCrc: string
  trAmount: string
  trAmountGrosze: number
  trPaid: string
  trPaidGrosze: number
  trDesc: string
  trStatus: TpayNotificationStatus
  trError: string
  trEmail: string
  trCurrency: 'PLN' | null
  md5sum: string
  testMode: string
}

const REQUIRED_FIELDS = [
  'id',
  'tr_id',
  'tr_date',
  'tr_crc',
  'tr_amount',
  'tr_paid',
  'tr_desc',
  'tr_status',
  'tr_error',
  'tr_email',
  'md5sum',
  'test_mode',
] as const

const SINGLE_VALUE_FIELDS = [
  'id',
  'tr_id',
  'tr_date',
  'tr_crc',
  'tr_amount',
  'tr_paid',
  'tr_status',
  'md5sum',
  'tr_currency',
] as const

const LENGTH_LIMITED_FIELDS = [
  'id',
  'tr_id',
  'tr_date',
  'tr_crc',
  'tr_amount',
  'tr_paid',
  'tr_status',
  'tr_currency',
  'md5sum',
  'test_mode',
] as const

const MAX_FIELD_LENGTH = 256
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/
const MD5_PATTERN = /^[0-9a-fA-F]{32}$/
export const TPAY_CRC_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function decodeBody(rawBody: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
  } catch {
    throw new TpayNotificationError('invalidEncoding')
  }
}

function decimalToGrosze(value: string): number {
  const match = DECIMAL_PATTERN.exec(value)
  if (!match) throw new TpayNotificationError('invalidAmount')
  const grosze = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(grosze)) throw new TpayNotificationError('invalidAmount')
  return grosze
}

export function parseTpayNotificationForm(rawBody: Buffer): TpayNotification {
  const params = new URLSearchParams(decodeBody(rawBody))

  for (const field of SINGLE_VALUE_FIELDS) {
    if (params.getAll(field).length > 1) throw new TpayNotificationError('duplicateField')
  }
  for (const field of REQUIRED_FIELDS) {
    if (!params.has(field)) throw new TpayNotificationError('missingField')
  }
  for (const field of LENGTH_LIMITED_FIELDS) {
    if ((params.get(field) ?? '').length > MAX_FIELD_LENGTH) throw new TpayNotificationError('fieldTooLong')
  }

  const read = (field: string): string => params.get(field) ?? ''

  const md5sum = read('md5sum')
  if (!MD5_PATTERN.test(md5sum)) throw new TpayNotificationError('invalidChecksumFormat')

  const trCrc = read('tr_crc')
  if (!TPAY_CRC_PATTERN.test(trCrc)) throw new TpayNotificationError('invalidCrc')

  const trAmount = read('tr_amount')
  const trPaid = read('tr_paid')
  const trAmountGrosze = decimalToGrosze(trAmount)
  const trPaidGrosze = decimalToGrosze(trPaid)

  let trCurrency: 'PLN' | null = null
  if (params.has('tr_currency')) {
    if (read('tr_currency').toUpperCase() !== 'PLN') throw new TpayNotificationError('invalidCurrency')
    trCurrency = 'PLN'
  }

  const trStatus = read('tr_status').toLowerCase()
  if (trStatus !== 'true' && trStatus !== 'chargeback') throw new TpayNotificationError('invalidStatus')

  return {
    id: read('id'),
    trId: read('tr_id'),
    trDate: read('tr_date'),
    trCrc,
    trAmount,
    trAmountGrosze,
    trPaid,
    trPaidGrosze,
    trDesc: read('tr_desc'),
    trStatus,
    trError: read('tr_error'),
    trEmail: read('tr_email'),
    trCurrency,
    md5sum: md5sum.toLowerCase(),
    testMode: read('test_mode'),
  }
}
