import type { EntityManager } from '@mikro-orm/core'
import type { FilterQuery } from '@mikro-orm/core'
import { ExchangeRate } from '../data/entities'
import { RateFetchingService } from './rateFetchingService'
import type { RateType } from './providers/base'

export interface RateSelectionOptions {
  maxDaysBack?: number
  autoFetch?: boolean
  provider?: string
  rateType?: RateType
}

export interface GetRateParams {
  fromCurrencyCode: string
  toCurrencyCode: string
  date: Date
  scope: { tenantId: string; organizationId: string }
  options?: RateSelectionOptions
}

export interface GetRatesParams {
  pairs: Array<{ fromCurrencyCode: string; toCurrencyCode: string }>
  date: Date
  scope: { tenantId: string; organizationId: string }
  options?: RateSelectionOptions
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
    this.validateDate(date)
    const fromCode = fromCurrencyCode.toUpperCase().trim()
    const toCode = toCurrencyCode.toUpperCase().trim()
    this.validateCurrencyCodes(fromCode, toCode)
    const selection = this.normalizeOptions(options)

    const result = await this.findRateWithFallback(
      fromCode,
      toCode,
      date,
      scope,
      selection,
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
    selection: Required<Pick<RateSelectionOptions, 'maxDaysBack' | 'autoFetch'>> & Pick<RateSelectionOptions, 'provider' | 'rateType'>,
    daysBack: number = 0
  ): Promise<RateResult> {
    // Stop if we've gone back too far
    if (daysBack > selection.maxDaysBack) {
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
      selection,
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
    if (selection.autoFetch) {
      const fetchResult = selection.provider
        ? await this.rateFetchingService.fetchRatesForDate(normalizedDate, scope, { providers: [selection.provider] })
        : await this.rateFetchingService.fetchRatesForDate(normalizedDate, scope)

      // If fetch was successful, try to find the rates again
      if (fetchResult.totalFetched > 0) {
        const fetchedRates = await this.findExactRates(
          fromCode,
          toCode,
          normalizedDate,
          scope,
          selection,
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
      selection,
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
    selection: Pick<RateSelectionOptions, 'provider' | 'rateType'>,
  ): Promise<ExchangeRate[]> {
    const normalizedDate = this.normalizeDate(date)

    const where: FilterQuery<ExchangeRate> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      fromCurrencyCode: fromCode,
      toCurrencyCode: toCode,
      date: normalizedDate,
      deletedAt: null,
      isActive: true,
    }
    if (selection.provider) {
      where.source = selection.provider
    } else {
      const explicitProviders = this.rateFetchingService.getProviderSources('explicit')
      if (explicitProviders.length > 0) where.source = { $nin: explicitProviders }
    }
    if (selection.rateType) where.type = selection.rateType
    return this.em.find(ExchangeRate, where)
  }

  /**
   * Validate that the date is not in the future
   * Allows today, rejects tomorrow and beyond
   */
  private validateDate(date: Date): void {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new Error('Exchange rate date must be a valid date')
    }
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
    const result = this.normalizeDate(date)
    result.setUTCDate(result.getUTCDate() - days)
    return result
  }

  private validateCurrencyCodes(fromCode: string, toCode: string): void {
    if (!/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) {
      throw new Error('Currency codes must be three-letter ISO codes')
    }
    if (fromCode === toCode) throw new Error('Cannot get exchange rate for the same currency')
  }

  private normalizeOptions(
    options: RateSelectionOptions | undefined,
  ): Required<Pick<RateSelectionOptions, 'maxDaysBack' | 'autoFetch'>> & Pick<RateSelectionOptions, 'provider' | 'rateType'> {
    const maxDaysBack = options?.maxDaysBack ?? 30
    if (!Number.isInteger(maxDaysBack) || maxDaysBack < 0 || maxDaysBack > 366) {
      throw new Error('maxDaysBack must be an integer from 0 through 366')
    }
    const autoFetch = options?.autoFetch ?? true
    if (typeof autoFetch !== 'boolean') throw new Error('autoFetch must be a boolean')

    const provider = options?.provider
    const normalizedProvider = provider === undefined ? undefined : provider.trim()
    if (provider !== undefined && (!normalizedProvider || !this.rateFetchingService.hasProvider(normalizedProvider))) {
      throw new Error('provider must name a registered rate provider')
    }
    const rateType = options?.rateType
    if (rateType !== undefined && !['buy', 'sell', 'average'].includes(rateType)) {
      throw new Error('rateType must be buy, sell, or average')
    }
    return { maxDaysBack, autoFetch, provider: normalizedProvider, rateType }
  }
}
