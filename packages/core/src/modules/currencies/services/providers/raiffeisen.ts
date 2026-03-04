import { RateProvider, RateProviderResult } from './base'
import { fromZonedTime } from 'date-fns-tz'

interface RaiffeisenResponse {
  date: string
  rates: Record<
    string,
    Array<{
      code: string
      units: number
      buy: string
      sell: string
      spread: string
      date: string
      time: string
    }>
  >
  range: {
    minRateDate: string
    maxRateDate: string
  }
}

// 
export class RaiffeisenPolandProvider implements RateProvider {
  readonly name = 'Raiffeisen Bank Polska'
  readonly source = 'Raiffeisen Bank Polska'
  readonly providerBaseCurrency = 'PLN'

  private readonly baseUrl = 'https://www.rbinternational.com.pl/rest/rates/'

  isAvailable(): boolean {
    return true
  }

  async fetchRates(
    date: Date,
    scope: { tenantId: string; organizationId: string },
    availableCurrencies: Set<string>
  ): Promise<RateProviderResult[]> {
    // Check if PLN is available (required as base currency for Raiffeisen)
    if (!availableCurrencies.has(this.providerBaseCurrency)) {
      console.debug('[Raiffeisen] Skipping: PLN not found in available currencies')
      return []
    }

    const dateStr = this.formatDate(date)
    const url = `${this.baseUrl}?type=kursywalut&range=all&date=${dateStr}`

    try {
      const response = await fetch(url)

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[Raiffeisen] No data available for ${dateStr}`)
          return []
        }
        throw new Error(
          `Raiffeisen API error: ${response.status} ${response.statusText}`
        )
      }

      const data: RaiffeisenResponse = await response.json()

      if (!data.rates || Object.keys(data.rates).length === 0) {
        return []
      }

      // Get FIRST time slot (opening rates)
      const times = Object.keys(data.rates).sort()
      const firstTime = times[0]
      const rates = data.rates[firstTime]

      const results: RateProviderResult[] = []
      
      // Extract time from first rate entry (all rates in same time slot have same time)
      const firstRate = rates[0]
      if (!firstRate) {
        console.log(`[Raiffeisen] No rates available in time slot ${firstTime}`)
        return []
      }

      // Combine date + time and parse as Europe/Warsaw timezone
      const rateDate = fromZonedTime(
        `${data.date} ${firstRate.time}`,
        'Europe/Warsaw'
      )

      for (const rateData of rates) {
        // Raiffeisen rates are from bank's perspective:
        // - SELL: bank sells XXX for PLN → 1 XXX = sell PLN
        // - BUY: bank buys XXX for PLN → 1 XXX = buy PLN
        
        // Rate 1: PLN → XXX (inverse of SELL) - this is when bank SELLS foreign currency
        // If sell = 4.5 (1 EUR costs 4.5 PLN), then 1 PLN = 1/4.5 EUR
        const sellRate = parseFloat(rateData.sell)
        results.push({
          fromCurrencyCode: this.providerBaseCurrency,
          toCurrencyCode: rateData.code,
          rate: (1 / sellRate).toString(),
          source: this.source,
          date: rateDate,
          type: 'sell', // Bank sells foreign currency (from their perspective)
        })

        // Rate 2: XXX → PLN (using BUY) - this is when bank BUYS foreign currency
        // If buy = 4.3 (1 EUR gives 4.3 PLN), then 1 EUR = 4.3 PLN
        results.push({
          fromCurrencyCode: rateData.code,
          toCurrencyCode: this.providerBaseCurrency,
          rate: rateData.buy,
          source: this.source,
          date: rateDate,
          type: 'buy', // Bank buys foreign currency (from their perspective)
        })
      }

      console.log(
        `[Raiffeisen] Fetched ${results.length} rates for ${dateStr} at ${firstRate.time} Warsaw time (${rateDate.toISOString()})`
      )
      return results
    } catch (err: any) {
      console.error(`[Raiffeisen] Fetch error for ${dateStr}:`, err)
      throw new Error(`Failed to fetch Raiffeisen rates: ${err.message}`)
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0] // YYYY-MM-DD
  }
}
