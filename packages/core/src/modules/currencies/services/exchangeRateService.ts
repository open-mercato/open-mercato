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
