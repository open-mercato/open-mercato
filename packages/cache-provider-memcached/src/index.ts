export { provider, createMemcachedCacheStrategy, type CreateMemcachedCacheStrategyOptions } from './provider'
export { provider as default } from './provider'
export {
  MEMCACHED_PROVIDER_ID,
  MEMCACHED_SETTINGS_DEFAULTS,
  memcachedSettingsSchema,
  redactMemcachedSettings,
  type MemcachedProviderConfig,
  type MemcachedProviderSettingsInput,
} from './settings'
export { MemcachedCacheError, isMemcachedCacheError, type MemcachedCacheErrorCode } from './errors'
export {
  LAYOUT_VERSION,
  bucketItemKey,
  bucketItemKeyFor,
  bucketIndexFor,
  routingKey,
} from './layout'
export type { MemcachedCacheStrategy, MemcachedStrategyDiagnostics } from './strategy'
