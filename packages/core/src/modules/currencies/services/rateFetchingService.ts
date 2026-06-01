import type { EntityManager } from '@mikro-orm/core'
import { RateProvider, RateProviderResult } from './providers/base'
import { Currency, ExchangeRate } from '../data/entities'

export interface FetchResult {
  totalFetched: number
  byProvider: Record<string, { count: number; errors?: string[] }>
  errors: string[]
}

export interface FetchOptions {
  providers?: string[]
  forceUpdate?: boolean
}

const exchangeRateKey = (
  fromCurrencyCode: string,
  toCurrencyCode: string,
  date: Date,
  source: string
): string => `${fromCurrencyCode}|${toCurrencyCode}|${date.getTime()}|${source}`

export class RateFetchingService {
  private providers: Map<string, RateProvider>

  constructor(private em: EntityManager) {
    this.providers = new Map()
  }

  /**
   * Register a rate provider
   */
  registerProvider(provider: RateProvider): void {
    this.providers.set(provider.source, provider)
  }

  async fetchRatesForDate(
    date: Date,
    scope: { tenantId: string; organizationId: string },
    options: FetchOptions = {}
  ): Promise<FetchResult> {
    const result: FetchResult = {
      totalFetched: 0,
      byProvider: {},
      errors: [],
    }

    // Get existing currencies for validation
    const existingCurrencies = await this.getExistingCurrencies(scope)
    const currencyCodeSet = new Set(existingCurrencies.map((c) => c.code))

    // Determine which providers to use
    const providerList = options.providers?.length
      ? options.providers
      : Array.from(this.providers.keys())

    for (const providerSource of providerList) {
      const provider = this.providers.get(providerSource)

      if (!provider) {
        result.errors.push(`Unknown provider: ${providerSource}`)
        continue
      }

      if (!provider.isAvailable()) {
        result.errors.push(`Provider not available: ${providerSource}`)
        continue
      }

      try {
        const rates = await provider.fetchRates(date, scope, currencyCodeSet)

        // Filter: only currencies that exist in both directions
        const validRates = rates.filter(
          (r) =>
            currencyCodeSet.has(r.fromCurrencyCode) &&
            currencyCodeSet.has(r.toCurrencyCode)
        )

        const stored = await this.storeRates(validRates, scope)

        result.byProvider[providerSource] = { count: stored }
        result.totalFetched += stored
      } catch (err: any) {
        const errorMsg = `${providerSource}: ${err.message}`
        result.errors.push(errorMsg)
        result.byProvider[providerSource] = {
          count: 0,
          errors: [err.message],
        }
      }
    }

    return result
  }

  private async getExistingCurrencies(scope: {
    tenantId: string
    organizationId: string
  }): Promise<Currency[]> {
    return this.em.find(Currency, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      deletedAt: null,
    })
  }

  private async storeRates(
    rates: RateProviderResult[],
    scope: { tenantId: string; organizationId: string }
  ): Promise<number> {
    if (rates.length === 0) return 0

    let stored = 0

    await this.em.transactional(async (em) => {
      // Prefetch every existing rate that could match this batch in a single query,
      // then index by composite key so the per-rate loop never hits the database.
      const fromCurrencyCodes = Array.from(new Set(rates.map((rate) => rate.fromCurrencyCode)))
      const toCurrencyCodes = Array.from(new Set(rates.map((rate) => rate.toCurrencyCode)))
      const sources = Array.from(new Set(rates.map((rate) => rate.source)))
      const dates = Array.from(new Set(rates.map((rate) => rate.date.getTime()))).map(
        (time) => new Date(time)
      )

      const existingRates = await em.find(ExchangeRate, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        fromCurrencyCode: { $in: fromCurrencyCodes },
        toCurrencyCode: { $in: toCurrencyCodes },
        date: { $in: dates },
        source: { $in: sources },
      })

      const existingByKey = new Map<string, ExchangeRate>()
      for (const existing of existingRates) {
        existingByKey.set(
          exchangeRateKey(existing.fromCurrencyCode, existing.toCurrencyCode, existing.date, existing.source),
          existing
        )
      }

      const now = new Date()
      for (const rate of rates) {
        const key = exchangeRateKey(rate.fromCurrencyCode, rate.toCurrencyCode, rate.date, rate.source)
        const existing = existingByKey.get(key)

        if (existing) {
          // Update existing rate
          existing.rate = rate.rate
          existing.type = rate.type ?? null
          existing.updatedAt = now
          em.persist(existing)
        } else {
          // Create new rate
          const newRate = em.create(ExchangeRate, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            fromCurrencyCode: rate.fromCurrencyCode,
            toCurrencyCode: rate.toCurrencyCode,
            rate: rate.rate,
            date: rate.date,
            source: rate.source,
            type: rate.type ?? null,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          em.persist(newRate)
          // Track so duplicate keys within the same batch update in memory instead of double-inserting.
          existingByKey.set(key, newRate)
        }

        stored++
      }

      // Flush all changes at once
      await em.flush()
    })

    return stored
  }
}
