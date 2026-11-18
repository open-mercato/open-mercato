import { leaseCreateBodySchema, leaseExtensionBodySchema } from '../data/validators'
import { formatAmount, multiplyAmount, parseAmountInput } from '../lib/money'

describe('parseAmountInput', () => {
  it('accepts numbers and decimal strings and normalizes them to a canonical string', () => {
    expect(parseAmountInput(1200)).toEqual({ ok: true, amount: '1200' })
    expect(parseAmountInput('1200')).toEqual({ ok: true, amount: '1200' })
    expect(parseAmountInput(' 1200.50 ')).toEqual({ ok: true, amount: '1200.5' })
    expect(parseAmountInput('2.0001')).toEqual({ ok: true, amount: '2.0001' })
    expect(parseAmountInput(0.1)).toEqual({ ok: true, amount: '0.1' })
    expect(parseAmountInput('0.0001')).toEqual({ ok: true, amount: '0.0001' })
    expect(parseAmountInput('3.10000000')).toEqual({ ok: true, amount: '3.1' })
    expect(parseAmountInput('999999999')).toEqual({ ok: true, amount: '999999999' })
  })

  it('refuses more than four decimal places instead of rounding them away', () => {
    expect(parseAmountInput(2.00005)).toEqual({ ok: false, issue: 'too_precise' })
    expect(parseAmountInput('2.00005')).toEqual({ ok: false, issue: 'too_precise' })
    expect(parseAmountInput(0.1 + 0.2)).toEqual({ ok: false, issue: 'too_precise' })
  })

  it('refuses zero, tiny, negative, oversized and malformed amounts', () => {
    expect(parseAmountInput(0)).toEqual({ ok: false, issue: 'out_of_range' })
    expect(parseAmountInput('0.0000')).toEqual({ ok: false, issue: 'out_of_range' })
    expect(parseAmountInput(1e-7)).toEqual({ ok: false, issue: 'invalid' })
    expect(parseAmountInput('0.00001')).toEqual({ ok: false, issue: 'too_precise' })
    expect(parseAmountInput(-5)).toEqual({ ok: false, issue: 'invalid' })
    expect(parseAmountInput('1000000000')).toEqual({ ok: false, issue: 'out_of_range' })
    expect(parseAmountInput(1e21)).toEqual({ ok: false, issue: 'invalid' })
    expect(parseAmountInput(Number.NaN)).toEqual({ ok: false, issue: 'invalid' })
    expect(parseAmountInput('1,5')).toEqual({ ok: false, issue: 'invalid' })
    expect(parseAmountInput('1e3')).toEqual({ ok: false, issue: 'invalid' })
    expect(parseAmountInput('')).toEqual({ ok: false, issue: 'invalid' })
    expect(parseAmountInput(null)).toEqual({ ok: false, issue: 'invalid' })
  })
})

describe('formatAmount and multiplyAmount', () => {
  it('rounds stored amounts half away from zero at four decimals without float drift', () => {
    expect(formatAmount('40.0000')).toBe('40')
    expect(formatAmount('2.00005')).toBe('2.0001')
    expect(formatAmount(2.00005)).toBe('2.0001')
    expect(formatAmount('1.23444')).toBe('1.2344')
    expect(formatAmount(1e-7)).toBe('0')
    expect(() => formatAmount('abc')).toThrow('[internal]')
  })

  it('multiplies a price by a whole quantity exactly', () => {
    expect(multiplyAmount('0.1', 3)).toBe('0.3')
    expect(multiplyAmount('12.3456', 7)).toBe('86.4192')
    expect(multiplyAmount('35.0000', 8)).toBe('280')
    expect(() => multiplyAmount('1', 1.5)).toThrow('[internal]')
  })
})

describe('lease rate validation', () => {
  const lease = { unitId: '11111111-1111-4111-8111-111111111111', customerCompanyId: '22222222-2222-4222-8222-222222222222', startsOn: '2030-01-01', termMonths: 12 }

  it('normalizes numbers and decimal strings to the string the lease persists and sends to sales', () => {
    expect(leaseCreateBodySchema.parse({ ...lease, monthlyRate: 1200 }).monthlyRate).toBe('1200')
    expect(leaseCreateBodySchema.parse({ ...lease, monthlyRate: '1234.5670' }).monthlyRate).toBe('1234.567')
    expect(leaseExtensionBodySchema.parse({ months: 3, monthlyRate: '99.9999' }).monthlyRate).toBe('99.9999')
  })

  it('reports over-precise and tiny rates with translatable keys', () => {
    const precise = leaseCreateBodySchema.safeParse({ ...lease, monthlyRate: 2.00005 })
    expect(precise.success).toBe(false)
    expect(precise.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([['monthlyRate', 'property_management.errors.rateTooPrecise']])
    const tiny = leaseExtensionBodySchema.safeParse({ months: 3, monthlyRate: 1e-7 })
    expect(tiny.error?.issues.map((issue) => issue.message)).toEqual(['property_management.errors.rateInvalid'])
    const zero = leaseCreateBodySchema.safeParse({ ...lease, monthlyRate: '0' })
    expect(zero.error?.issues.map((issue) => issue.message)).toEqual(['property_management.errors.rateInvalid'])
  })
})
