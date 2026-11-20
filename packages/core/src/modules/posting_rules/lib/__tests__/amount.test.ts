import { isNonZeroAmount } from '../amount'

describe('isNonZeroAmount', () => {
  it.each(['250.0000', '0.0001', '100.00', '1', '10', '0.5000', '9007199254740993.0000'])(
    'treats %s as non-zero',
    (value) => {
      expect(isNonZeroAmount(value)).toBe(true)
    },
  )

  it.each(['0', '0.00', '0.0000', '000.0000'])('treats %s as zero', (value) => {
    expect(isNonZeroAmount(value)).toBe(false)
  })
})
