import type { EntityManager } from '@mikro-orm/core'
import { ExchangeRate } from '../data/entities'
import { RateFetchingService } from './rateFetchingService'

export interface GetRateParams {
  fromCurrencyCode: string
  toCurrencyCode: string
  date: Date
  scope: { tenantId: string; organizationId: string }
  options?: {
    maxDaysBack?: number // Maximum days to look back (default: 30)
    autoFetch?: boolean // Fetch if not found (default: true)
  }
}

export interface GetRatesParams {
  pairs: Array<{ fromCurrencyCode: string; toCurrencyCode: string }>
  date: Date
  scope: { tenantId: string; organizationId: string }
  options?: {
    maxDaysBack?: number
    autoFetch?: boolean
  }
}

export interface GetStoredRatesForOrganizationsParams {
  tenantId: string
  requests: Array<{
    organizationId: string
    pairs: Array<{ fromCurrencyCode: string; toCurrencyCode: string }>
  }>
  date: Date
  maxDaysBack?: number
}

export interface RateResult {
  rates: ExchangeRate[]
  fromCurrencyCode: string
  toCurrencyCode: string
  requestedDate: Date
  actualDate: Date | null
  error?: Error // Present when the operation failed
}

export class ExchangeRateService {
  constructor(
    private readonly em: EntityManager,
    private readonly rateFetchingService: RateFetchingService
  ) {}

  /**
   * Get exchange rates for a currency pair on a specific date
   * Returns all rates from different providers (exact matches only)
   * If not found, fetches from providers and tries previous days recursively
   * 
   * Note: maxDaysBack means the service will check the requested date plus up to
   * maxDaysBack previous days (total checks = maxDaysBack + 1)
   */
  async getRate(params: GetRateParams): Promise<RateResult> {
    const { fromCurrencyCode, toCurrencyCode, date, scope, options } = params
    const maxDaysBack = options?.maxDaysBack ?? 30
    const autoFetch = options?.autoFetch ?? true

    // Validate date is not in the future
    this.validateDate(date)

    // Normalize currency codes
    const fromCode = fromCurrencyCode.toUpperCase().trim()
    const toCode = toCurrencyCode.toUpperCase().trim()

    // Validate same currency
    if (fromCode === toCode) {
      throw new Error('Cannot get exchange rate for the same currency')
    }

    // Try to find rates recursively, going back day by day
    const result = await this.findRateWithFallback(
      fromCode,
      toCode,
      date,
      scope,
      maxDaysBack,
      autoFetch
    )

    return result
  }

  /**
   * Get multiple exchange rates at once (batch operation)
   * Errors are captured in the result's error field rather than thrown
   */
  async getRates(params: GetRatesParams): Promise<Map<string, RateResult>> {
    const { pairs, date, scope, options } = params
    const results = new Map<string, RateResult>()

    // Process each pair
    for (const pair of pairs) {
      const key = `${pair.fromCurrencyCode}/${pair.toCurrencyCode}`
      try {
        const result = await this.getRate({
          fromCurrencyCode: pair.fromCurrencyCode,
          toCurrencyCode: pair.toCurrencyCode,
          date,
          scope,
          options,
        })
        results.set(key, result)
      } catch (err) {
        // Capture error in result
        const error = err instanceof Error ? err : new Error(String(err))
        results.set(key, {
          rates: [],
          fromCurrencyCode: pair.fromCurrencyCode,
          toCurrencyCode: pair.toCurrencyCode,
          requestedDate: date,
          actualDate: null,
          error,
        })
      }
    }

    return results
  }

  /**
   * Batched, read-only counterpart of `getRates` with `autoFetch: false` for several
   * organizations at once. Every organization resolves each pair from its own stored rates
   * only — the most recent day between `date` and `maxDaysBack` days earlier (default 30),
   * matched on exact UTC days exactly like `getRate` — so a rate stored in one organization
   * is never used for another. All organizations, pairs and days are read in one statement.
   *
   * Returns organizationId → `FROM/TO` → result; a pair without a stored rate has
   * `rates: []` and `actualDate: null`.
   */
  async getStoredRatesForOrganizations(
    params: GetStoredRatesForOrganizationsParams,
  ): Promise<Map<string, Map<string, RateResult>>> {
    const { tenantId, requests, date } = params
    const maxDaysBack = params.maxDaysBack ?? 30
    this.validateDate(date)

    const requested = new Map<string, Map<string, { fromCode: string; toCode: string }>>()
    const fromCodes = new Set<string>()
    const toCodes = new Set<string>()
    for (const { organizationId, pairs } of requests) {
      const organizationPairs = requested.get(organizationId) ?? new Map<string, { fromCode: string; toCode: string }>()
      for (const pair of pairs) {
        const fromCode = pair.fromCurrencyCode.toUpperCase().trim()
        const toCode = pair.toCurrencyCode.toUpperCase().trim()
        if (!fromCode || !toCode || fromCode === toCode) continue
        organizationPairs.set(`${fromCode}/${toCode}`, { fromCode, toCode })
        fromCodes.add(fromCode)
        toCodes.add(toCode)
      }
      requested.set(organizationId, organizationPairs)
    }

    const results = new Map<string, Map<string, RateResult>>()
    if (fromCodes.size === 0) {
      for (const organizationId of requested.keys()) results.set(organizationId, new Map())
      return results
    }

    const lastDay = this.normalizeDate(date)
    const days = Array.from(
      { length: maxDaysBack + 1 },
      (_, offset) => new Date(lastDay.getTime() - offset * 24 * 60 * 60 * 1000),
    )
    const rows = await this.em.find(ExchangeRate, {
      tenantId,
      organizationId: { $in: Array.from(requested.keys()) },
      fromCurrencyCode: { $in: Array.from(fromCodes) },
      toCurrencyCode: { $in: Array.from(toCodes) },
      date: { $in: days },
      deletedAt: null,
      isActive: true,
    })

    const latestByKey = new Map<string, { day: number; rates: ExchangeRate[] }>()
    for (const row of rows) {
      const key = `${row.organizationId}|${row.fromCurrencyCode}/${row.toCurrencyCode}`
      const day = new Date(row.date).getTime()
      const current = latestByKey.get(key)
      if (!current || day > current.day) {
        latestByKey.set(key, { day, rates: [row] })
      } else if (day === current.day) {
        current.rates.push(row)
      }
    }

    for (const [organizationId, organizationPairs] of requested) {
      const organizationResults = new Map<string, RateResult>()
      for (const [pairKey, { fromCode, toCode }] of organizationPairs) {
        const latest = latestByKey.get(`${organizationId}|${pairKey}`)
        organizationResults.set(pairKey, {
          rates: latest?.rates ?? [],
          fromCurrencyCode: fromCode,
          toCurrencyCode: toCode,
          requestedDate: date,
          actualDate: latest ? new Date(latest.day) : null,
        })
      }
      results.set(organizationId, organizationResults)
    }
    return results
  }

  /**
   * Recursively find exchange rate, trying to fetch if not found
   * Goes back day by day up to maxDaysBack
   */
  private async findRateWithFallback(
    fromCode: string,
    toCode: string,
    date: Date,
    scope: { tenantId: string; organizationId: string },
    maxDaysBack: number,
    autoFetch: boolean,
    daysBack: number = 0
  ): Promise<RateResult> {
    // Stop if we've gone back too far
    if (daysBack > maxDaysBack) {
      return {
        rates: [],
        fromCurrencyCode: fromCode,
        toCurrencyCode: toCode,
        requestedDate: date,
        actualDate: null,
      }
    }

    // Calculate the date we're checking
    const checkDate = this.subtractDays(date, daysBack)
    const normalizedDate = this.normalizeDate(checkDate)

    // Try to find existing rates in the database
    const existingRates = await this.findExactRates(
      fromCode,
      toCode,
      normalizedDate,
      scope
    )

    // If found, return them
    if (existingRates.length > 0) {
      return {
        rates: existingRates,
        fromCurrencyCode: fromCode,
        toCurrencyCode: toCode,
        requestedDate: date,
        actualDate: normalizedDate,
      }
    }

    // If not found and autoFetch is enabled, try fetching
    if (autoFetch) {
      const fetchResult = await this.rateFetchingService.fetchRatesForDate(
        normalizedDate,
        scope
      )

      // If fetch was successful, try to find the rates again
      if (fetchResult.totalFetched > 0) {
        const fetchedRates = await this.findExactRates(
          fromCode,
          toCode,
          normalizedDate,
          scope
        )

        if (fetchedRates.length > 0) {
          return {
            rates: fetchedRates,
            fromCurrencyCode: fromCode,
            toCurrencyCode: toCode,
            requestedDate: date,
            actualDate: normalizedDate,
          }
        }
      }
    }

    // Not found, try the previous day
    return this.findRateWithFallback(
      fromCode,
      toCode,
      date,
      scope,
      maxDaysBack,
      autoFetch,
      daysBack + 1
    )
  }

  /**
   * Find exact matching rates in the database
   * Returns all rates from different providers for the same pair and date
   */
  private async findExactRates(
    fromCode: string,
    toCode: string,
    date: Date,
    scope: { tenantId: string; organizationId: string }
  ): Promise<ExchangeRate[]> {
    const normalizedDate = this.normalizeDate(date)

    return this.em.find(ExchangeRate, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      fromCurrencyCode: fromCode,
      toCurrencyCode: toCode,
      date: normalizedDate,
      deletedAt: null,
      isActive: true,
    })
  }

  /**
   * Validate that the date is not in the future
   * Allows today, rejects tomorrow and beyond
   */
  private validateDate(date: Date): void {
    const now = new Date()
    const normalizedNow = new Date(now)
    normalizedNow.setUTCHours(0, 0, 0, 0)

    const normalizedDate = this.normalizeDate(date)

    if (normalizedDate > normalizedNow) {
      throw new Error('Cannot get exchange rate for a future date')
    }
  }

  /**
   * Normalize date to start of day in UTC
   * Exchange rates are typically stored as daily values
   */
  private normalizeDate(date: Date): Date {
    const normalized = new Date(date)
    normalized.setUTCHours(0, 0, 0, 0)
    return normalized
  }

  /**
   * Subtract days from a date
   */
  private subtractDays(date: Date, days: number): Date {
    const result = new Date(date)
    result.setDate(result.getDate() - days)
    return result
  }
}
