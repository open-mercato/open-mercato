export interface RateProviderResult {
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string // Numeric string for precision
  source: string
  date: Date
}

export interface RateProvider {
  readonly name: string
  readonly source: string

  fetchRates(
    date: Date,
    scope: { tenantId: string; organizationId: string }
  ): Promise<RateProviderResult[]>

  isAvailable(): boolean
}
