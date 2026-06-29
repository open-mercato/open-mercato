import type { ChannelAdapter } from './adapter'
import { validateAdapterCapabilities } from './adapter-compat'

/**
 * Channel adapter registry — process-level singleton backed by `globalThis`.
 *
 * Mirrors the `shipping_carriers/lib/adapter-registry.ts` pattern so that
 * unauthenticated webhook routes (which have not yet built a tenant-scoped DI
 * container) can resolve adapters by `providerKey`. DI consumers continue to
 * resolve the same registry via the `channelAdapterRegistry` binding declared
 * in `di.ts` — that binding is a thin proxy over these functions.
 *
 * The registry validates each adapter at registration time (see
 * `validateAdapterCapabilities`) and refuses duplicate `providerKey` registrations.
 */

const CHANNEL_ADAPTER_REGISTRY_KEY = Symbol.for('@open-mercato/communication-channels/adapter-registry')

type GlobalWithChannelRegistry = typeof globalThis & {
  [CHANNEL_ADAPTER_REGISTRY_KEY]?: Map<string, ChannelAdapter>
}

function getRegistryMap(): Map<string, ChannelAdapter> {
  const scope = globalThis as GlobalWithChannelRegistry
  if (!scope[CHANNEL_ADAPTER_REGISTRY_KEY]) {
    scope[CHANNEL_ADAPTER_REGISTRY_KEY] = new Map<string, ChannelAdapter>()
  }
  return scope[CHANNEL_ADAPTER_REGISTRY_KEY]!
}

export function registerChannelAdapter(adapter: ChannelAdapter): () => void {
  validateAdapterCapabilities(adapter)
  const map = getRegistryMap()
  if (map.has(adapter.providerKey)) {
    throw new Error(
      `ChannelAdapter '${adapter.providerKey}' is already registered. ` +
        'Each provider package must declare a unique providerKey.',
    )
  }
  map.set(adapter.providerKey, adapter)
  return () => {
    map.delete(adapter.providerKey)
  }
}

export function getChannelAdapter(providerKey: string): ChannelAdapter | undefined {
  return getRegistryMap().get(providerKey)
}

export function listChannelAdapters(): ChannelAdapter[] {
  return Array.from(getRegistryMap().values())
}

export function listChannelAdapterProviderKeys(): string[] {
  return Array.from(getRegistryMap().keys())
}

export function hasChannelAdapter(providerKey: string): boolean {
  return getRegistryMap().has(providerKey)
}

/**
 * Clear the registry. Primarily for tests that need a fresh registry between cases.
 * NOT for production use — at runtime, adapters are registered once at boot.
 */
export function clearChannelAdapters(): void {
  getRegistryMap().clear()
}

/**
 * Class wrapper kept for DI consumers and test ergonomics. All instances back
 * onto the same `globalThis` storage so DI consumers and direct module callers
 * see the same registry.
 */
export class ChannelAdapterRegistry {
  register(adapter: ChannelAdapter): void {
    registerChannelAdapter(adapter)
  }

  get(providerKey: string): ChannelAdapter | undefined {
    return getChannelAdapter(providerKey)
  }

  list(): ChannelAdapter[] {
    return listChannelAdapters()
  }

  providerKeys(): string[] {
    return listChannelAdapterProviderKeys()
  }

  has(providerKey: string): boolean {
    return hasChannelAdapter(providerKey)
  }

  clear(): void {
    clearChannelAdapters()
  }
}
