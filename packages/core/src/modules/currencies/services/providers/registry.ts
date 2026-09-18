import type { RateProvider } from './base'

const CURRENCY_RATE_PROVIDER_REGISTRY_KEY = Symbol.for('@open-mercato/currencies/rate-provider-registry')

type GlobalWithCurrencyRateProviderRegistry = typeof globalThis & {
  [CURRENCY_RATE_PROVIDER_REGISTRY_KEY]?: Map<string, RateProvider>
}

function getProviderRegistry(): Map<string, RateProvider> {
  const globalScope = globalThis as GlobalWithCurrencyRateProviderRegistry
  if (!globalScope[CURRENCY_RATE_PROVIDER_REGISTRY_KEY]) {
    globalScope[CURRENCY_RATE_PROVIDER_REGISTRY_KEY] = new Map<string, RateProvider>()
  }
  return globalScope[CURRENCY_RATE_PROVIDER_REGISTRY_KEY]
}

export function registerCurrencyRateProvider(provider: RateProvider): () => void {
  const providerRegistry = getProviderRegistry()
  providerRegistry.set(provider.source, provider)
  return () => {
    if (providerRegistry.get(provider.source) === provider) providerRegistry.delete(provider.source)
  }
}

export function getCurrencyRateProvider(source: string): RateProvider | undefined {
  return getProviderRegistry().get(source)
}

export function listCurrencyRateProviders(): RateProvider[] {
  return Array.from(getProviderRegistry().values())
}

export function clearCurrencyRateProviders(): void {
  getProviderRegistry().clear()
}
