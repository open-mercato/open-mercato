import { toGrosze, toTpayAmount } from '../lib/amount'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => `translated:${key}` }),
}))

describe('tpay amount handling', () => {
  it.each([
    [0.1 + 0.2, 30],
    [10.005, 1001],
    [1.005, 101],
    [123.45, 12345],
    [10.004, 1000],
    [0.005, 1],
    [1, 100],
    [99999.999, 10000000],
  ])('rounds %p half-up to %p grosze', (amount, grosze) => {
    expect(toGrosze(amount)).toBe(grosze)
  })

  it.each([0, -1, -0.01, 0.004, Number.NaN, Number.POSITIVE_INFINITY, 1e21])('rejects %p', (amount) => {
    expect(toGrosze(amount)).toBeNull()
  })

  it('returns a two-decimal number for tpay', async () => {
    await expect(toTpayAmount(0.1 + 0.2)).resolves.toBe(0.3)
    await expect(toTpayAmount(10.005)).resolves.toBe(10.01)
  })

  it('throws a translated 422 for an invalid amount', async () => {
    await expect(toTpayAmount(0)).rejects.toMatchObject({
      status: 422,
      body: { error: 'translated:gateway_tpay.errors.invalidAmount', code: 'gateway_tpay.errors.invalidAmount' },
    })
  })
})
