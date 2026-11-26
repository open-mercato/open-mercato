import type {
  CacheProviderCapability,
  CacheProviderDefinition,
  CacheProviderHostContext,
  CacheProviderSettingsSchema,
} from '@open-mercato/cache/provider'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { createIoredisClientFactory } from './client'
import type { RespClientFactoryOptions } from './client'
import { detectRespServer } from './server'
import type { RespServerEngine } from './server'
import { redactRespSettings, respTransportWarnings } from './settings'
import type { RespSettings } from './settings'
import { createRespCacheStrategy } from './strategy'

export type RespCacheProviderOptions<TConfig extends RespSettings> = {
  id: string
  settings: CacheProviderSettingsSchema<TConfig>
  /** Engine the package is qualified against; a different engine behind the endpoint is logged once. */
  expectedEngine?: RespServerEngine
  clientOptions?: (config: TConfig, context: CacheProviderHostContext) => RespClientFactoryOptions
}

const ERROR_LOG_INTERVAL_MS = 30_000

const TRANSPORT_WARNING_MESSAGES = {
  tls_verification_disabled: 'TLS server certificate verification is disabled (tls.rejectUnauthorized: false); the connection is open to interception',
  credentials_over_plaintext: 'credentials are sent over a plaintext connection; configure tls',
} as const

/**
 * Build everything a RESP cache provider definition needs except `apiVersion`,
 * so the provider package passes it to `defineCacheProvider` itself.
 */
export function createRespCacheProvider<TConfig extends RespSettings>(
  options: RespCacheProviderOptions<TConfig>,
): Omit<CacheProviderDefinition<TConfig>, 'apiVersion'> {
  return {
    id: options.id,
    settings: options.settings,
    capability(): CacheProviderCapability {
      return { placement: 'shared' }
    },
    async create(config: TConfig, context: CacheProviderHostContext): Promise<CacheStrategy> {
      let lastErrorLoggedAt = 0
      const extra = options.clientOptions ? options.clientOptions(config, context) : {}
      for (const warning of respTransportWarnings(config, { externalCredentials: extra.credentialsProvider !== undefined })) {
        context.logger.warn(TRANSPORT_WARNING_MESSAGES[warning])
      }
      const factory = createIoredisClientFactory(config, {
        ...extra,
        onError: (error) => {
          extra.onError?.(error)
          const now = Date.now()
          if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return
          lastErrorLoggedAt = now
          context.logger.warn('connection error; the client is reconnecting', { error })
        },
      })
      const managed = await factory()
      const strategy = await createRespCacheStrategy(() => managed, {
        namespace: context.namespace,
        helpers: context.helpers,
        logger: context.logger,
        ...(context.defaultTtl !== undefined ? { defaultTtl: context.defaultTtl } : {}),
        batchSize: config.batchSize,
        maxValueBytes: config.maxValueBytes,
        timeouts: { connectMs: config.connectTimeoutMs },
      })
      if (options.expectedEngine) {
        const server = await detectRespServer(managed.client)
        if (server && server.engine !== options.expectedEngine) {
          context.logger.warn('endpoint reports a different engine than this provider is qualified for', {
            expected: options.expectedEngine,
            reported: server.engine,
            version: server.version,
          })
        }
      }
      return strategy
    },
    redact(config: TConfig): Record<string, unknown> {
      return redactRespSettings(config)
    },
  }
}
