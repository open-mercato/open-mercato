import {
  formatMachineDecimal,
  isZeroDecimal,
  negateDecimal,
  roundDecimalHalfUp,
  subtractDecimalStrings,
  sumDecimalStrings,
} from '../money'

describe('financial money arithmetic', () => {
  describe('roundDecimalHalfUp', () => {
    it('rounds on the decimal the caller wrote, not its binary approximation', () => {
      // The case that makes this file exist: 1.005 is stored as 1.00499999…, so
      // Math.round(1.005 * 100) is 100 where an invoice must show 1.01.
      expect(roundDecimalHalfUp('1.005', 2)).toBe('1.01')
      expect(roundDecimalHalfUp('2.675', 2)).toBe('2.68')
      expect(roundDecimalHalfUp(1.005, 2)).toBe('1.01')
    })

    it('rounds half away from zero and carries across the whole part', () => {
      expect(roundDecimalHalfUp('0.005', 2)).toBe('0.01')
      expect(roundDecimalHalfUp('9.995', 2)).toBe('10.00')
      expect(roundDecimalHalfUp('-1.005', 2)).toBe('-1.01')
    })

    it('leaves an exact amount alone and pads to the scale', () => {
      expect(roundDecimalHalfUp('115', 2)).toBe('115.00')
      expect(roundDecimalHalfUp('115.5', 2)).toBe('115.50')
      expect(roundDecimalHalfUp('115.499', 2)).toBe('115.50')
    })

    it('never renders a signed zero', () => {
      expect(roundDecimalHalfUp('-0.001', 2)).toBe('0.00')
      expect(roundDecimalHalfUp('-0', 2)).toBe('0.00')
    })

    it('supports the zero scale and rejects a nonsense one', () => {
      expect(roundDecimalHalfUp('2.5', 0)).toBe('3')
      expect(roundDecimalHalfUp('2.4', 0)).toBe('2')
      expect(() => roundDecimalHalfUp('1', -1)).toThrow()
      expect(() => roundDecimalHalfUp('1', 1.5)).toThrow()
    })

    it('refuses anything that is not a plain decimal', () => {
      expect(() => roundDecimalHalfUp('1e3', 2)).toThrow()
      expect(() => roundDecimalHalfUp('abc', 2)).toThrow()
      expect(() => roundDecimalHalfUp('', 2)).toThrow()
      expect(() => roundDecimalHalfUp(Number.NaN, 2)).toThrow()
    })
  })

  describe('sumDecimalStrings', () => {
    it('adds exactly where floats would drift', () => {
      expect(sumDecimalStrings(['0.1', '0.2'])).toBe('0.300000')
      expect(sumDecimalStrings(['115.00', '0.05', '0.05'])).toBe('115.100000')
    })

    it('handles negatives and a net of zero', () => {
      expect(sumDecimalStrings(['10.00', '-10.00'])).toBe('0.000000')
      expect(sumDecimalStrings(['-1.50', '-2.25'])).toBe('-3.750000')
    })

    it('is empty-safe', () => {
      expect(sumDecimalStrings([])).toBe('0.000000')
    })
  })

  describe('subtractDecimalStrings', () => {
    it('subtracts and keeps the sign of the result', () => {
      expect(subtractDecimalStrings('15.00', '5.05')).toBe('9.950000')
      expect(subtractDecimalStrings('5.00', '15.00')).toBe('-10.000000')
      expect(subtractDecimalStrings('0.00', '-2.50')).toBe('2.500000')
    })
  })

  describe('negateDecimal', () => {
    it('flips a sign and leaves zero unsigned', () => {
      expect(negateDecimal('1.00')).toBe('-1.00')
      expect(negateDecimal('-1.00')).toBe('1.00')
      expect(negateDecimal('0.00')).toBe('0.00')
      expect(negateDecimal('-0.00')).toBe('0.00')
    })
  })

  describe('formatMachineDecimal', () => {
    it('is the canonical QR/storage form: dot, fixed digits, no grouping', () => {
      expect(formatMachineDecimal('1234.5')).toBe('1234.50')
      expect(formatMachineDecimal('1234.567')).toBe('1234.57')
      expect(formatMachineDecimal(0)).toBe('0.00')
    })
  })

  describe('isZeroDecimal', () => {
    it('recognises zero however it is written', () => {
      expect(isZeroDecimal('0')).toBe(true)
      expect(isZeroDecimal('0.000')).toBe(true)
      expect(isZeroDecimal('-0.00')).toBe(true)
      expect(isZeroDecimal('0.01')).toBe(false)
      expect(isZeroDecimal('1')).toBe(false)
    })
  })
})
