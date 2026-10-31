import { z } from 'zod'
import { fetchWithTimeout, resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { RateProvider, RateProviderResult } from './base'

export const NBP_AVERAGE_PROVIDER_SOURCE = 'nbp_average'

const logger = createLogger('currencies').child({ component: 'nbp-average' })
const DEFAULT_RATE_FETCH_TIMEOUT_MS = 15_000
const BASE_URL = 'https://api.nbp.pl/api'

const tableResponseSchema = z.array(z.object({
  table: z.enum(['A', 'B']),
  no: z.string(),
  effectiveDate: z.string(),
  rates: z.array(z.object({
    currency: z.string(),
    code: z.string(),
    mid: z.number(),
  })).max(500),
})).length(1)

type NbpAverageTable = z.infer<typeof tableResponseSchema>[number]

function resolveRateFetchTimeoutMs(): number {
  const raw = process.env.CURRENCY_RATE_FETCH_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : undefined
  return resolveTimeoutMs(parsed, DEFAULT_RATE_FETCH_TIMEOUT_MS)
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseEffectiveDate(value: string, requestedDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value !== requestedDate) {
    throw new Error('NBP effective date does not match the requested date')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || formatDate(parsed) !== value) {
    throw new Error('NBP effective date is invalid')
  }
  return parsed
}

function parseReference(value: string, table: 'A' | 'B'): string {
  const reference = value.trim()
  if (!reference || reference.length > 100 || !new RegExp(`(^|/)${table}(?=/|$)`).test(reference)) {
    throw new Error(`NBP table ${table} publication number is invalid`)
  }
  return reference
}

function parseCurrencyCode(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error('NBP currency code is invalid')
  }
  return code
}

export class NBPAverageRateProvider implements RateProvider {
  readonly name = 'NBP average rates (tables A/B)'
  readonly source = NBP_AVERAGE_PROVIDER_SOURCE
  readonly providerBaseCurrency = 'PLN'
  readonly selectionMode = 'explicit' as const

  isAvailable(): boolean {
    return true
  }

  async fetchRates(
    date: Date,
    _scope: { tenantId: string; organizationId: string },
    availableCurrencies: Set<string>,
  ): Promise<RateProviderResult[]> {
    if (!availableCurrencies.has(this.providerBaseCurrency)) {
      logger.debug('Skipping average rates because PLN is unavailable')
      return []
    }

    const requestedDate = formatDate(date)
    const [tableA, tableB] = await Promise.all([
      this.fetchTable('A', requestedDate),
      this.fetchTable('B', requestedDate),
    ])
    const tables = [tableA, tableB].filter((table): table is NbpAverageTable => table !== null)
    const currencyCodes = new Set<string>()
    const results: RateProviderResult[] = []

    for (const table of tables) {
      const effectiveDate = parseEffectiveDate(table.effectiveDate, requestedDate)
      const reference = parseReference(table.no, table.table)
      for (const row of table.rates) {
        const code = parseCurrencyCode(row.code)
        if (!Number.isFinite(row.mid) || row.mid <= 0) {
          throw new Error(`NBP mid rate is invalid for ${code}`)
        }
        if (currencyCodes.has(code)) {
          throw new Error(`NBP average-rate tables contain duplicate currency: ${code}`)
        }
        currencyCodes.add(code)
        results.push({
          fromCurrencyCode: code,
          toCurrencyCode: this.providerBaseCurrency,
          rate: String(row.mid),
          source: this.source,
          date: effectiveDate,
          type: 'average',
          externalReference: reference,
        })
      }
    }

    logger.info('Fetched average rates', {
      source: this.source,
      date: requestedDate,
      tables: tables.map((table) => table.table),
      count: results.length,
    })
    return results
  }

  private async fetchTable(table: 'A' | 'B', date: string): Promise<NbpAverageTable | null> {
    const response = await fetchWithTimeout(
      `${BASE_URL}/exchangerates/tables/${table.toLowerCase()}/${date}/?format=json`,
      { timeoutMs: resolveRateFetchTimeoutMs() },
    )
    if (response.status === 404) {
      logger.debug('No NBP average table publication', { source: this.source, date, table })
      return null
    }
    if (!response.ok) {
      throw new Error(`NBP table ${table} request failed with status ${response.status}`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(`NBP table ${table} returned invalid JSON`)
    }
    const parsed = tableResponseSchema.safeParse(payload)
    if (!parsed.success || parsed.data[0].table !== table) {
      throw new Error(`NBP table ${table} response is invalid`)
    }
    return parsed.data[0]
  }
}
