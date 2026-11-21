import type { EntityManager } from '@mikro-orm/core'
import { ExchangeRate } from '../data/entities'
import { RateFetchingService } from './rateFetchingService'

export interface GetRateParams {
  fromCurrencyCode: string
  toCurrencyCode: string
  date: Date
  scope: { tenantId: string; organizationId: string }
  /**
   * Restrict the lookup to one rate source (e.g. 'NBP_A').
   *
   * Omitted: every stored rate of the day is returned and a fetch (when `autoFetch`) only
   * happens if no source has a row for that day (previous behaviour, unchanged).
   *
   * Set: only rows of this source count. A day without such a row triggers a fetch limited to
   * this one provider, and only when that fetch yields nothing does the lookup step back a day.
   * Use it when a different source (e.g. NBP Table C) may already have stored a row for the day
   * and must not hide the one the caller needs.
   */
  source?: string
  options?: {
    maxDaysBack?: number // Maximum days to look back (default: 30)
    autoFetch?: boolean // Fetch if not found (default: true)
  }
}

export interface GetRatesParams {
  pairs: Array<{ fromCurrencyCode: string; toCurrencyCode: string }>
  date: Date
  scope: { tenantId: string; organizationId: string }
  /** See `GetRateParams.source`; applies to every pair of the batch. */
  source?: string
  options?: {
    maxDaysBack?: number
    autoFetch?: boolean
  }
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
   * Returns all rates from different providers (exact matches only), or only those of
   * `params.source` when it is set
   * If not found, fetches from providers and tries previous days recursively
   * 
   * Note: maxDaysBack means the service will check the requested date plus up to
   * maxDaysBack previous days (total checks = maxDaysBack + 1)
   */
  async getRate(params: GetRateParams): Promise<RateResult> {
    const { fromCurrencyCode, toCurrencyCode, date, scope, options } = params
    const source = params.source?.trim() || undefined
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
      autoFetch,
      source
    )

    return result
  }

  /**
   * Get multiple exchange rates at once (batch operation)
   * Errors are captured in the result's error field rather than thrown
   */
  async getRates(params: GetRatesParams): Promise<Map<string, RateResult>> {
    const { pairs, date, scope, source, options } = params
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
          source,
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
    source: string | undefined,
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
      scope,
      source
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
      // With a source, only that provider is asked: a row of another source on the same day
      // must not stop the fetch (see GetRateParams.source).
      const fetchResult = source
        ? await this.rateFetchingService.fetchRatesForDate(normalizedDate, scope, {
            providers: [source],
          })
        : await this.rateFetchingService.fetchRatesForDate(normalizedDate, scope)

      // If fetch was successful, try to find the rates again
      if (fetchResult.totalFetched > 0) {
        const fetchedRates = await this.findExactRates(
          fromCode,
          toCode,
          normalizedDate,
          scope,
          source
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
      source,
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
    scope: { tenantId: string; organizationId: string },
    source?: string
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
      ...(source ? { source } : {}),
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
