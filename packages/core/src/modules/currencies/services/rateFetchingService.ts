import type { EntityManager } from '@mikro-orm/core'
import { RateProvider, RateProviderResult } from './providers/base'
import { NBPProvider } from './providers/nbp'
import { RaiffeisenProvider } from './providers/raiffeisen'
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

export class RateFetchingService {
  private providers: Map<string, RateProvider>

  constructor(private em: EntityManager) {
    this.providers = new Map()
    this.registerProvider(new NBPProvider())
    this.registerProvider(new RaiffeisenProvider())
  }

  private registerProvider(provider: RateProvider): void {
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

    // Always ensure PLN exists
    currencyCodeSet.add('PLN')

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
        const rates = await provider.fetchRates(date, scope)

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
    let stored = 0

    await this.em.transactional(async (em) => {
      for (const rate of rates) {
        // Check if rate already exists
        const existing = await em.findOne(ExchangeRate, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          fromCurrencyCode: rate.fromCurrencyCode,
          toCurrencyCode: rate.toCurrencyCode,
          date: rate.date,
          source: rate.source,
        })

        if (existing) {
          // Update existing rate
          existing.rate = rate.rate
          existing.updatedAt = new Date()
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
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          em.persist(newRate)
        }

        stored++
      }
      
      // Flush all changes at once
      await em.flush()
    })

    return stored
  }
}
