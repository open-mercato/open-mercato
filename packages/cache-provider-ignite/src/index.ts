import { defineCacheProvider } from '@open-mercato/cache/provider'
import { createIgniteConnection } from './connection'
import { igniteCacheName } from './layout'
import { createIgniteStrategy } from './strategy'
import {
  IGNITE_PROVIDER_ID,
  igniteCacheProviderSettingsSchema,
  igniteTransportWarnings,
  redactIgniteCacheProviderConfig,
  type IgniteCacheProviderConfig,
} from './settings'

const TRANSPORT_WARNING_MESSAGES = {
  tls_verification_disabled: 'TLS server certificate verification is disabled (tls.rejectUnauthorized: false); the connection is open to interception',
  credentials_over_plaintext: 'credentials are sent over a plaintext connection; configure tls',
} as const

export {
  IGNITE_PROVIDER_ID,
  DEFAULT_CACHE_NAME_PREFIX,
  DEFAULT_CAS_ATTEMPTS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_MAX_VALUE_BYTES,
  DEFAULT_MUTATION_CONCURRENCY,
  DEFAULT_SCAN_PAGE_SIZE,
  DEFAULT_SCAN_TIMEOUT_MS,
  igniteCacheProviderSettingsSchema,
  igniteTransportWarnings,
  redactIgniteCacheProviderConfig,
} from './settings'
export type { IgniteCacheProviderConfig, IgniteCacheProviderSettingsInput, IgniteTransportWarning } from './settings'
export { igniteCacheName, RECORD_FORMAT_VERSION } from './layout'
export { IgniteCacheValueTooLargeError } from './strategy'

export const provider = defineCacheProvider<IgniteCacheProviderConfig>({
  id: IGNITE_PROVIDER_ID,
  settings: igniteCacheProviderSettingsSchema,
  capability() {
    return { placement: 'shared' }
  },
  async create(config, context) {
    for (const warning of igniteTransportWarnings(config)) context.logger.warn(TRANSPORT_WARNING_MESSAGES[warning])
    const connection = createIgniteConnection(config, igniteCacheName(config.cacheNamePrefix, context.namespace))
    const strategy = createIgniteStrategy(config, context, connection)
    try {
      await strategy.healthcheck!()
    } catch (error) {
      await connection.close()
      throw error
    }
    return strategy
  },
  redact: redactIgniteCacheProviderConfig,
})

export default provider
