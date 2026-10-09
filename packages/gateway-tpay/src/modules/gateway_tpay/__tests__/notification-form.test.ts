import { createHash } from 'node:crypto'
import { computeTpayMd5, verifyTpayMd5 } from '../lib/checksum'
import { parseTpayNotificationForm, TpayNotificationError } from '../lib/notification-form'

const CRC = '3f1b6a52-8c0e-4f6a-9d2b-1a2b3c4d5e6f'

function baseFields(): Record<string, string> {
  return {
    id: '12345',
    tr_id: 'TR-0001',
    tr_date: '2026-10-09 12:00:00',
    tr_crc: CRC,
    tr_amount: '12.30',
    tr_paid: '12.30',
    tr_desc: 'Order 1',
    tr_status: 'TRUE',
    tr_error: 'none',
    tr_email: 'buyer@example.com',
    md5sum: computeTpayMd5({ id: '12345', trId: 'TR-0001', trAmount: '12.30', trCrc: CRC, securityCode: 'sec' }),
    test_mode: '0',
  }
}

function body(fields: Record<string, string>, extra: Array<[string, string]> = []): Buffer {
  const params = new URLSearchParams(fields)
  for (const [key, value] of extra) params.append(key, value)
  return Buffer.from(params.toString(), 'utf8')
}

function reasonOf(raw: Buffer): string | null {
  try {
    parseTpayNotificationForm(raw)
    return null
  } catch (error) {
    return error instanceof TpayNotificationError ? error.reason : 'other'
  }
}

describe('parseTpayNotificationForm', () => {
  it('parses a valid notification', () => {
    const result = parseTpayNotificationForm(body(baseFields()))
    expect(result).toMatchObject({
      id: '12345',
      trId: 'TR-0001',
      trCrc: CRC,
      trAmountGrosze: 1230,
      trPaidGrosze: 1230,
      trStatus: 'true',
      trCurrency: null,
    })
  })

  it.each(['id', 'tr_id', 'tr_date', 'tr_crc', 'tr_amount', 'tr_paid', 'tr_desc', 'tr_status', 'tr_error', 'tr_email', 'md5sum', 'test_mode'])(
    'rejects missing %s',
    (field) => {
      const fields = baseFields()
      delete fields[field]
      expect(reasonOf(body(fields))).toBe('missingField')
    },
  )

  it('rejects duplicate security fields', () => {
    expect(reasonOf(body(baseFields(), [['tr_amount', '1.00']]))).toBe('duplicateField')
    expect(reasonOf(body(baseFields(), [['md5sum', 'a'.repeat(32)]]))).toBe('duplicateField')
  })

  it('rejects invalid UTF-8', () => {
    expect(reasonOf(Buffer.from([0x69, 0x64, 0x3d, 0xff, 0xfe]))).toBe('invalidEncoding')
  })

  it.each(['1,00', '1.001', '-1', '', '.5', '1e2'])('rejects amount %p', (amount) => {
    expect(reasonOf(body({ ...baseFields(), tr_amount: amount }))).toBe('invalidAmount')
  })

  it('parses decimals to grosze without floats', () => {
    const fields = { ...baseFields(), tr_amount: '0.1', tr_paid: '1' }
    const result = parseTpayNotificationForm(body(fields))
    expect(result.trAmountGrosze).toBe(10)
    expect(result.trPaidGrosze).toBe(100)
  })

  it('validates currency', () => {
    expect(reasonOf(body({ ...baseFields(), tr_currency: 'EUR' }))).toBe('invalidCurrency')
    expect(parseTpayNotificationForm(body({ ...baseFields(), tr_currency: 'pln' })).trCurrency).toBe('PLN')
  })

  it('validates status case-insensitively', () => {
    expect(reasonOf(body({ ...baseFields(), tr_status: 'FALSE' }))).toBe('invalidStatus')
    expect(parseTpayNotificationForm(body({ ...baseFields(), tr_status: 'ChargeBack' })).trStatus).toBe('chargeback')
  })

  it('rejects invalid crc, checksum format and long fields', () => {
    expect(reasonOf(body({ ...baseFields(), tr_crc: 'not-a-uuid' }))).toBe('invalidCrc')
    expect(reasonOf(body({ ...baseFields(), md5sum: 'xyz' }))).toBe('invalidChecksumFormat')
    expect(reasonOf(body({ ...baseFields(), tr_desc: 'a'.repeat(257) }))).toBe('fieldTooLong')
  })

  it('never includes field values in error messages', () => {
    try {
      parseTpayNotificationForm(body({ ...baseFields(), tr_amount: '9,99' }))
    } catch (error) {
      expect((error as Error).message).not.toContain('9,99')
      expect((error as Error).message.startsWith('[internal]')).toBe(true)
    }
  })
})

describe('tpay md5', () => {
  it('matches the documented concatenation', () => {
    const expected = createHash('md5').update(`1TR12.30${CRC}sec`).digest('hex')
    expect(computeTpayMd5({ id: '1', trId: 'TR1', trAmount: '2.30', trCrc: CRC, securityCode: 'sec' })).toBe(expected)
  })

  it('verifies with timing-safe comparison', () => {
    const sum = computeTpayMd5({ id: '1', trId: 'a', trAmount: '1.00', trCrc: CRC, securityCode: 's' })
    const flipped = `${sum.slice(0, 31)}${sum.endsWith('0') ? '1' : '0'}`
    expect(verifyTpayMd5(sum, sum.toUpperCase())).toBe(true)
    expect(verifyTpayMd5(sum, flipped)).toBe(false)
    expect(verifyTpayMd5(sum, sum.slice(0, 31))).toBe(false)
  })
})
