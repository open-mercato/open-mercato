import type { CacheProviderRegistration } from '@open-mercato/cache/provider'

// Stock settings belong in the deployment environment. For example:
// CACHE_STRATEGY=memory
// CACHE_MEMORY_MAX_ENTRIES=50000
// CACHE_TTL=300000
//
// To opt into an npm provider, install @open-mercato/cache-provider-valkey and
// add this registration to cacheProviders:
// {
//   id: 'open-mercato/valkey',
//   load: () => import('@open-mercato/cache-provider-valkey').then(({ provider }) => provider),
//   settings: () => ({
//     host: process.env.CACHE_VALKEY_HOST,
//     port: Number(process.env.CACHE_VALKEY_PORT ?? 6379),
//     username: process.env.CACHE_VALKEY_USERNAME,
//     password: process.env.CACHE_VALKEY_PASSWORD,
//   }),
// }
// Set CACHE_PROVIDER=open-mercato/valkey and a unique CACHE_PROVIDER_NAMESPACE.
// See the Valkey package guide to configure TLS for production.
export const cacheProviders: CacheProviderRegistration[] = []
