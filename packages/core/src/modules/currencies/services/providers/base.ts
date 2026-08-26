export type RateType = 'buy' | 'sell' | 'average'

export type ProviderSelectionMode = 'default' | 'explicit'

export interface RateProviderResult {
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string // Numeric string for precision
  source: string
  date: Date
  type?: RateType | null // Rate type from bank's perspective
  externalReference?: string | null
}

export interface RateProvider {
  readonly name: string
  readonly source: string
  readonly providerBaseCurrency?: string // The base currency for this provider (e.g., 'PLN')
  readonly selectionMode?: ProviderSelectionMode

  fetchRates(
    date: Date,
    scope: { tenantId: string; organizationId: string },
    availableCurrencies: Set<string>
  ): Promise<RateProviderResult[]>

  isAvailable(): boolean
}
