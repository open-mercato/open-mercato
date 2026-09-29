import type { RateProvider } from '../base'
import {
  clearCurrencyRateProviders,
  getCurrencyRateProvider,
  listCurrencyRateProviders,
  registerCurrencyRateProvider,
} from '../registry'

function provider(source: string): RateProvider {
  return {
    source,
    isAvailable: () => true,
    fetchRates: async () => [],
  }
}

describe('currency rate provider registry', () => {
  beforeEach(() => clearCurrencyRateProviders())
  afterEach(() => clearCurrencyRateProviders())

  it('registers providers by stable source and supports disposal', () => {
    const first = provider('example_fixed_rates')
    const replacement = provider('example_fixed_rates')
    const disposeFirst = registerCurrencyRateProvider(first)

    expect(getCurrencyRateProvider(first.source)).toBe(first)

    registerCurrencyRateProvider(replacement)
    expect(listCurrencyRateProviders()).toEqual([replacement])

    disposeFirst()
    expect(listCurrencyRateProviders()).toEqual([replacement])
  })
})
