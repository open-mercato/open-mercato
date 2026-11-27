import { assertCartQuantity, fitsCartQuantityStorage, toWritableCartQuantity } from '../quantity'

describe('cart storage quantity', () => {
  it.each([NaN, Infinity, -Infinity, null, {}, '1e300', '0.00001', '1000000000000', '9'.repeat(2049)])('rejects %s without numeric rounding', (quantity) => {
    expect(fitsCartQuantityStorage(quantity)).toBe(false)
  })

  it('normalizes equivalent decimals without losing their digits', () => {
    expect(assertCartQuantity('0001.23000')).toBe('1.23')
    expect(assertCartQuantity('999999999999.9997')).toBe('999999999999.9997')
  })

  it('keeps validated storage quantities consistent with Sales and accepts zero only for writes', () => {
    expect(toWritableCartQuantity('999999999999.9997')).toBe('999999999999.9998')
    expect(toWritableCartQuantity(0)).toBe('0')
    expect(() => toWritableCartQuantity('1.00001')).toThrow(expect.objectContaining({ status: 400 }))
  })

  it.each(['1000000000000', '0', '-1'])('rejects unsupported command quantity %s with a client error', (quantity) => {
    expect(() => assertCartQuantity(quantity)).toThrow(expect.objectContaining({ status: 400, body: { error: 'cart.errors.quantity_invalid', code: 'cart_quantity_invalid' } }))
  })
})
