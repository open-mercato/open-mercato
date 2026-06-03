/**
 * Public alias for the channel-adapter registry, exposing the function-form API.
 *
 * Webhook routes (auth-less, no DI request scope yet) import from here to look up
 * adapters by `providerKey`. Inside a normal DI scope you can equivalently resolve
 * `container.resolve('channelAdapterRegistry')` — both share the same storage
 * (process-level `globalThis` symbol).
 */
import {
  ChannelAdapterRegistry,
  getChannelAdapter,
  hasChannelAdapter,
  listChannelAdapters,
  listChannelAdapterProviderKeys,
  registerChannelAdapter,
} from './registry'

export {
  getChannelAdapter,
  hasChannelAdapter,
  listChannelAdapters,
  listChannelAdapterProviderKeys,
  registerChannelAdapter,
}

/**
 * Returns a singleton registry instance (class form). Useful when callers want
 * to pass a registry through DI or to a worker context without binding to module
 * globals directly.
 */
let cachedRegistry: ChannelAdapterRegistry | null = null
export function getChannelAdapterRegistry(): ChannelAdapterRegistry {
  if (!cachedRegistry) cachedRegistry = new ChannelAdapterRegistry()
  return cachedRegistry
}
