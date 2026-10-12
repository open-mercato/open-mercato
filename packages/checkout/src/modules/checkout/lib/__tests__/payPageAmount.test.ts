import {
  applyPayPageAmountValue,
  buildPayPageSubmitBody,
  formatPayPageAmount,
  parsePayPageAmountInput,
  toPayPageAmount,
  validatePayPageCustomAmount,
} from '../payPageAmount'

const BASE_SUBMIT_DATA = {
  customerData: { email: 'payer@example.com' },
  acceptedLegalConsents: { terms: true },
  selectedPriceItemId: null,
}

describe('pay page amount payload', () => {
  it('submits the exact fixed price instead of its float', () => {
    const fixed = toPayPageAmount(Number('1234.567890123456789012'), '1234.567890123456789012')
    const body = buildPayPageSubmitBody({ ...BASE_SUBMIT_DATA, ...fixed })

    expect(body).toEqual({ ...BASE_SUBMIT_DATA, amount: '1234.567890123456789012' })
    expect(JSON.parse(JSON.stringify(body)).amount).toBe('1234.567890123456789012')
  })

  it('submits the exact amount of a selected price-list item', () => {
    const item = { id: 'eth', amount: Number('0.123456789012345678'), amountExact: '0.123456789012345678' }
    const body = buildPayPageSubmitBody({
      ...BASE_SUBMIT_DATA,
      ...toPayPageAmount(item.amount, item.amountExact),
      selectedPriceItemId: item.id,
    })

    expect(body).toEqual({ ...BASE_SUBMIT_DATA, amount: '0.123456789012345678', selectedPriceItemId: 'eth' })
  })

  it('falls back to the number for legacy items without an exact amount', () => {
    expect(buildPayPageSubmitBody({ ...BASE_SUBMIT_DATA, ...toPayPageAmount(149.5, undefined) }).amount).toBe('149.5')
  })

  it('submits a typed custom amount with every digit', () => {
    const typed = parsePayPageAmountInput(' 1.000000000000000001 ')

    expect(typed).toEqual({ amount: 1, amountExact: '1.000000000000000001' })
    expect(buildPayPageSubmitBody({ ...BASE_SUBMIT_DATA, ...typed }).amount).toBe('1.000000000000000001')
  })

  it('submits null when no amount is set', () => {
    expect(parsePayPageAmountInput('')).toEqual({ amount: null, amountExact: null })
    expect(parsePayPageAmountInput('abc')).toEqual({ amount: null, amountExact: null })
    expect(buildPayPageSubmitBody({ ...BASE_SUBMIT_DATA, amount: null, amountExact: null }).amount).toBeNull()
  })

  it('uses the number when an injection widget changed it without the exact string', () => {
    const typed = parsePayPageAmountInput('1.000000000000000001')
    expect(buildPayPageSubmitBody({ ...BASE_SUBMIT_DATA, ...typed, amount: 25 }).amount).toBe('25')
    expect(buildPayPageSubmitBody({ ...BASE_SUBMIT_DATA, amount: 25 }).amount).toBe('25')
  })

  it('keeps the exact string when the form API re-applies the same number', () => {
    const typed = parsePayPageAmountInput('1.000000000000000001')

    expect(applyPayPageAmountValue(typed, 1)).toEqual(typed)
    expect(applyPayPageAmountValue(typed, 2)).toEqual({ amount: 2, amountExact: '2' })
    expect(applyPayPageAmountValue(typed, '3.000000000000000003')).toEqual({ amount: 3, amountExact: '3.000000000000000003' })
    expect(applyPayPageAmountValue(typed, null)).toEqual({ amount: null, amountExact: null })
  })
})

describe('formatPayPageAmount', () => {
  it('keeps all exact digits and the application locale', () => {
    const exact = '1234.567890123456789012'
    expect(formatPayPageAmount(Number(exact), 'ETH', 'en-US', exact)).toBe('ETH\u00a01,234.567890123456789012')
    expect(formatPayPageAmount(Number(exact), 'ETH', 'pl-PL', exact)).toBe('1234,567890123456789012\u00a0ETH')
    expect(formatPayPageAmount(1e-18, 'ETH', 'en-US', '0.000000000000000001')).toBe('ETH\u00a00.000000000000000001')
  })

  it('keeps the currency padding for legacy values', () => {
    expect(formatPayPageAmount(10, 'USD', 'en-US')).toBe('$10.00')
    expect(formatPayPageAmount(10, 'JPY', 'en-US')).toBe('¥10')
    expect(formatPayPageAmount(10, 'KWD', 'en-US')).toBe('KWD\u00a010.000')
  })
})

describe('validatePayPageCustomAmount', () => {
  const bounds = {
    customAmountMin: 1,
    customAmountMinExact: '1.000000000000000001',
    customAmountMax: 2,
    customAmountMaxExact: '2.000000000000000001',
  }

  it('accepts exactly the minimum and maximum', () => {
    expect(validatePayPageCustomAmount(bounds, parsePayPageAmountInput('1.000000000000000001'))).toBeNull()
    expect(validatePayPageCustomAmount(bounds, parsePayPageAmountInput('2.000000000000000001'))).toBeNull()
  })

  it('rejects amounts outside the bounds beyond float precision', () => {
    expect(validatePayPageCustomAmount(bounds, parsePayPageAmountInput('1'))).toBe('min')
    expect(validatePayPageCustomAmount(bounds, parsePayPageAmountInput('2.000000000000000002'))).toBe('max')
  })

  it('requires an amount', () => {
    expect(validatePayPageCustomAmount(bounds, { amount: null, amountExact: null })).toBe('required')
  })

  it('compares against the numbers when exact bounds are missing', () => {
    expect(validatePayPageCustomAmount({ customAmountMin: 5, customAmountMax: 10 }, { amount: 4.99, amountExact: null })).toBe('min')
    expect(validatePayPageCustomAmount({ customAmountMin: 5, customAmountMax: 10 }, { amount: 10, amountExact: null })).toBeNull()
  })
})
