import { defineCacheProvider, type CacheProviderHostContext } from '@open-mercato/cache/provider'
import { createMemcachedClient, type MemcachedClient } from './protocol/client'
import { createTcpTransport, type MemcachedTransport } from './protocol/transport'
import { toProviderFailure } from './errors'
import {
  MEMCACHED_PROVIDER_ID,
  memcachedSettingsSchema,
  redactMemcachedSettings,
  type MemcachedProviderConfig,
} from './settings'
import { createMemcachedStrategy, probeMemcachedServer, type MemcachedCacheStrategy } from './strategy'

export type CreateMemcachedCacheStrategyOptions = {
  /** Override the transport (tests, custom socket setups). Defaults to plain TCP to `host:port`. */
  transport?: MemcachedTransport
}

export async function createMemcachedCacheStrategy(
  config: MemcachedProviderConfig,
  context: CacheProviderHostContext,
  options: CreateMemcachedCacheStrategyOptions = {},
): Promise<MemcachedCacheStrategy> {
  const client: MemcachedClient = createMemcachedClient({
    transport: options.transport ?? createTcpTransport({ host: config.host, port: config.port }),
    poolSize: config.poolSize,
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    maxCommandBytes: config.maxCommandBytes,
  })
  let server: { itemSizeMax: number | null }
  try {
    server = await probeMemcachedServer(client)
  } catch (error) {
    await client.close().catch(() => undefined)
    throw toProviderFailure(error)
  }
  if (server.itemSizeMax !== null && server.itemSizeMax < config.maxItemBytes) {
    context.logger.warn('server item size limit is lower than maxItemBytes; using the server limit', {
      serverItemSizeMax: server.itemSizeMax,
      maxItemBytes: config.maxItemBytes,
    })
  }
  return createMemcachedStrategy(client, config, context, server)
}

export const provider = defineCacheProvider<MemcachedProviderConfig>({
  id: MEMCACHED_PROVIDER_ID,
  settings: memcachedSettingsSchema,
  capability: () => ({ placement: 'shared' }),
  create: (config, context) => createMemcachedCacheStrategy(config, context),
  redact: redactMemcachedSettings,
})

export default provider
