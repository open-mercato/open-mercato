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

type ProviderFetchOutcome =
  | { kind: 'skipped'; providerSource: string; error: string }
  | { kind: 'failed'; providerSource: string; error: string }
  | { kind: 'fetched'; providerSource: string; rates: RateProviderResult[] }

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

    // Fetch every provider concurrently: provider calls are independent network I/O,
    // so overlapping them caps total latency at the slowest provider instead of the sum
    // of all provider timeouts. Each provider is isolated in its own try/catch so a
    // single failure never rejects the batch.
    const outcomes = await Promise.all(
      providerList.map((providerSource) =>
        this.fetchFromProvider(providerSource, date, scope, currencyCodeSet)
      )
    )

    // Persist sequentially in provider order: a single EntityManager is not safe for
    // concurrent transactions, and stable ordering keeps DB writes and the byProvider
    // response shape deterministic regardless of which fetch resolved first.
    for (const outcome of outcomes) {
      if (outcome.kind === 'skipped') {
        result.errors.push(outcome.error)
        continue
      }

      if (outcome.kind === 'failed') {
        result.errors.push(`${outcome.providerSource}: ${outcome.error}`)
        result.byProvider[outcome.providerSource] = { count: 0, errors: [outcome.error] }
        continue
      }

      try {
        const stored = await this.storeRates(outcome.rates, scope)
        result.byProvider[outcome.providerSource] = { count: stored }
        result.totalFetched += stored
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`${outcome.providerSource}: ${message}`)
        result.byProvider[outcome.providerSource] = { count: 0, errors: [message] }
      }
    }

    return result
  }

  private async fetchFromProvider(
    providerSource: string,
    date: Date,
    scope: { tenantId: string; organizationId: string },
    currencyCodeSet: Set<string>
  ): Promise<ProviderFetchOutcome> {
    const provider = this.providers.get(providerSource)

    if (!provider) {
      return { kind: 'skipped', providerSource, error: `Unknown provider: ${providerSource}` }
    }

    if (!provider.isAvailable()) {
      return { kind: 'skipped', providerSource, error: `Provider not available: ${providerSource}` }
    }

    try {
      const rates = await provider.fetchRates(date, scope, currencyCodeSet)

      // Filter: only currencies that exist in both directions
      const validRates = rates.filter(
        (r) =>
          currencyCodeSet.has(r.fromCurrencyCode) &&
          currencyCodeSet.has(r.toCurrencyCode)
      )

      return { kind: 'fetched', providerSource, rates: validRates }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { kind: 'failed', providerSource, error: message }
    }
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
