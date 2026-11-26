import type { CacheProviderRegistration } from '@open-mercato/cache/provider'

// Stock strategies are available by default with CACHE_STRATEGY.
// To add an npm provider, install it and add a registration like this:
// {
//   id: 'acme/example',
//   load: () => import('@acme/cache-provider-example').then((pkg) => pkg.default),
//   settings: () => ({ endpoint: process.env.ACME_CACHE_ENDPOINT }),
// }
// Select the registered ID with CACHE_PROVIDER and set CACHE_PROVIDER_NAMESPACE.
export const cacheProviders: CacheProviderRegistration[] = []
