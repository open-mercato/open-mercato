import { RateProvider, RateProviderResult } from './base'
import { fromZonedTime } from 'date-fns-tz'

interface NBPTableCResponse {
  table: string
  no: string
  tradingDate: string
  effectiveDate: string
  rates: Array<{
    currency: string
    code: string
    bid: number
    ask: number
  }>
}

export class NBPProvider implements RateProvider {
  readonly name = 'NBP (National Bank of Poland)'
  readonly source = 'NBP'
  readonly providerBaseCurrency = 'PLN'

  private readonly baseUrl = 'https://api.nbp.pl/api'

  isAvailable(): boolean {
    return true // Public API, always available
  }

  async fetchRates(
    date: Date,
    scope: { tenantId: string; organizationId: string },
    availableCurrencies: Set<string>
  ): Promise<RateProviderResult[]> {
    // Check if PLN is available (required as base currency for NBP)
    if (!availableCurrencies.has(this.providerBaseCurrency)) {
      console.debug('[NBP] Skipping: PLN not found in available currencies')
      return []
    }

    const dateStr = this.formatDate(date)
    const url = `${this.baseUrl}/exchangerates/tables/c/${dateStr}/?format=json`

    try {
      const response = await fetch(url)

      if (response.status === 404) {
        // No data for this date (weekend/holiday)
        console.log(`[NBP] No data available for ${dateStr}`)
        return []
      }

      if (!response.ok) {
        throw new Error(`NBP API error: ${response.status} ${response.statusText}`)
      }

      const data: NBPTableCResponse[] = await response.json()

      if (!data || data.length === 0) {
        return []
      }

      const table = data[0]
      const results: RateProviderResult[] = []
      
      // Parse as midnight Europe/Warsaw, then convert to UTC for DB storage
      const effectiveDate = fromZonedTime(
        `${table.effectiveDate} 00:00:00`,
        'Europe/Warsaw'
      )

      for (const rate of table.rates) {
        // NBP rates are from bank's perspective:
        // - ASK (sprzedaż): bank sells XXX for PLN → 1 XXX = ask PLN
        // - BID (kupno): bank buys XXX for PLN → 1 XXX = bid PLN
        
        // Rate 1: PLN → XXX (inverse of ASK) - this is when bank SELLS foreign currency
        // If ask = 4.5 (1 EUR costs 4.5 PLN), then 1 PLN = 1/4.5 EUR
        results.push({
          fromCurrencyCode: this.providerBaseCurrency,
          toCurrencyCode: rate.code,
          rate: (1 / rate.ask).toString(),
          source: this.source,
          date: effectiveDate,
          type: 'sell', // Bank sells foreign currency (from their perspective)
        })

        // Rate 2: XXX → PLN (using BID) - this is when bank BUYS foreign currency
        // If bid = 4.3 (1 EUR gives 4.3 PLN), then 1 EUR = 4.3 PLN
        results.push({
          fromCurrencyCode: rate.code,
          toCurrencyCode: this.providerBaseCurrency,
          rate: rate.bid.toString(),
          source: this.source,
          date: effectiveDate,
          type: 'buy', // Bank buys foreign currency (from their perspective)
        })
      }

      console.log(`[NBP] Fetched ${results.length} rates for ${dateStr}`)
      return results
    } catch (err: any) {
      console.error(`[NBP] Fetch error for ${dateStr}:`, err.message)
      throw new Error(`Failed to fetch NBP rates: ${err.message}`)
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0] // YYYY-MM-DD
  }
}
