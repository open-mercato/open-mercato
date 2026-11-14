import { RateProvider, RateProviderResult } from './base'
import { fetchWithTimeout, resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('currencies').child({ component: 'nbp-table-a' })

const DEFAULT_RATE_FETCH_TIMEOUT_MS = 15_000

function resolveRateFetchTimeoutMs(): number {
  const raw = process.env.CURRENCY_RATE_FETCH_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : undefined
  return resolveTimeoutMs(parsed, DEFAULT_RATE_FETCH_TIMEOUT_MS)
}

interface NBPTableAResponse {
  table: string
  no: string
  effectiveDate: string
  rates: Array<{
    currency: string
    code: string
    mid: number
  }>
}

/**
 * NBP Table A: the average (mid) exchange rate published each business day.
 *
 * This is the rate Polish bookkeeping uses to convert foreign-currency operations into PLN
 * (art. 30 ust. 2 pkt 2 ustawy o rachunkowości): the average rate of the last day before the
 * operation date for which NBP published a table. `NBPProvider` (Table C, buy/sell) cannot
 * stand in for it, so the two are separate sources and callers ask for this one through the
 * `source` option of `ExchangeRateService.getRate`.
 *
 * Only the XXX -> PLN direction is stored, with `type: null` because a mid rate has no side.
 * The date of a stored row is the table's `effectiveDate` (the publication day) at UTC midnight,
 * the instant `ExchangeRateService.getRate` matches on.
 */
export class NBPTableAProvider implements RateProvider {
  readonly name = 'NBP Table A (average rates)'
  readonly source = 'NBP_A'
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
    if (!availableCurrencies.has(this.providerBaseCurrency)) {
      logger.debug('Skipping: PLN not found in available currencies')
      return []
    }

    const dateStr = this.formatDate(date)
    const url = `${this.baseUrl}/exchangerates/tables/a/${dateStr}/?format=json`

    try {
      const response = await fetchWithTimeout(url, { timeoutMs: resolveRateFetchTimeoutMs() })

      if (response.status === 404) {
        // No table for this date (weekend/holiday): the caller steps back to an earlier day
        logger.debug('No data available', { date: dateStr })
        return []
      }

      if (!response.ok) {
        throw new Error(`NBP API error: ${response.status} ${response.statusText}`)
      }

      const data: NBPTableAResponse[] = await response.json()

      if (!data || data.length === 0) {
        return []
      }

      const table = data[0]

      // Stamp the row at UTC midnight of the table's effective date, not at Warsaw midnight:
      // ExchangeRateService looks rates up by an exact match on UTC midnight of the requested day
      // (`normalizeDate`), so any other instant would never be found by `getRate`.
      const effectiveDate = new Date(`${table.effectiveDate}T00:00:00.000Z`)

      const results: RateProviderResult[] = table.rates.map((rate) => ({
        fromCurrencyCode: rate.code,
        toCurrencyCode: this.providerBaseCurrency,
        // Table A publishes 4 decimals; keep the number exactly as NBP gave it
        rate: rate.mid.toString(),
        source: this.source,
        date: effectiveDate,
        type: null,
      }))

      logger.info('Fetched rates', { count: results.length, date: dateStr })
      return results
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Fetch error', { date: dateStr, err })
      throw new Error(`[internal] Failed to fetch NBP Table A rates: ${message}`)
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0] // YYYY-MM-DD
  }
}
