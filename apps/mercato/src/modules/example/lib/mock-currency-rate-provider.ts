import type {
  RateProvider,
  RateProviderResult,
} from '@open-mercato/core/modules/currencies/services/providers/base'

const EXAMPLE_RATES = [
  { fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', rate: '0.9200' },
  { fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.0870' },
] as const

export const exampleCurrencyRateProvider: RateProvider = {
  name: 'Example fixed rates',
  source: 'example_fixed_rates',
  providerBaseCurrency: 'USD',

  isAvailable() {
    return true
  },

  async fetchRates(
    date: Date,
    _scope: { tenantId: string; organizationId: string },
    availableCurrencies: Set<string>,
  ): Promise<RateProviderResult[]> {
    return EXAMPLE_RATES
      .filter((rate) => (
        availableCurrencies.has(rate.fromCurrencyCode)
        && availableCurrencies.has(rate.toCurrencyCode)
      ))
      .map((rate) => ({
        ...rate,
        source: 'example_fixed_rates',
        date: new Date(date.getTime()),
        type: null,
      }))
  },
}

