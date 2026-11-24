export {
  createMemcachedClient,
  planKeyBatches,
  MAX_COMMAND_BYTES,
  DEFAULT_POOL_SIZE,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  type MemcachedClient,
  type MemcachedClientOptions,
  type MemcachedCommandName,
} from './client'
export {
  MAX_KEY_BYTES,
  assertValidKey,
  type MemcachedItem,
  type MetaSetMode,
  type MetaSetOptions,
  type MetaSetOutcome,
  type MetaDeleteOutcome,
  type ClassicStoreOptions,
  type ClassicStoreOutcome,
} from './commands'
export {
  MemcachedProtocolError,
  isMemcachedProtocolError,
  isMemcachedConnectionError,
  type MemcachedProtocolErrorCode,
} from './errors'
export {
  createTcpTransport,
  createTlsTransport,
  type MemcachedSocket,
  type MemcachedTransport,
  type MemcachedTransportOpenOptions,
  type MemcachedTcpEndpoint,
  type MemcachedTlsOptions,
} from './transport'
