import type { ChannelAdapter, ChannelCapabilities } from './adapter'

/**
 * Capability flags that imply the presence of an optional adapter method.
 * If the adapter declares the flag = true but does not implement the corresponding
 * method, registration fails with a clear error.
 *
 * NOTE: This is the strict registration validator; it replaces what an earlier
 * draft of SPEC-045d called a "v1 fallback". There is no v1 in shipping code,
 * so no fallback is needed — the contract is strict by design.
 */
const CAPABILITY_METHOD_PAIRS: Array<{
  flag: keyof ChannelCapabilities
  method: keyof ChannelAdapter
}> = [
  { flag: 'reactions', method: 'sendReaction' },
  { flag: 'reactions', method: 'removeReaction' },
  { flag: 'editMessage', method: 'editMessage' },
  { flag: 'deleteMessage', method: 'deleteMessage' },
  { flag: 'conversationHistory', method: 'fetchHistory' },
]

/**
 * Validates that every capability flag set to `true` on the adapter has its
 * corresponding optional method implemented. Throws a descriptive Error if a
 * capability/method pair is inconsistent.
 *
 * Called by the channel adapter registry at registration time; fails fast at
 * module boot rather than at runtime when the hub tries to invoke the missing
 * method.
 */
export function validateAdapterCapabilities(adapter: ChannelAdapter): void {
  if (!adapter.providerKey) {
    throw new Error('ChannelAdapter is missing required `providerKey` property')
  }
  if (!adapter.channelType) {
    throw new Error(
      `ChannelAdapter '${adapter.providerKey}' is missing required \`channelType\` property`,
    )
  }
  if (!adapter.capabilities) {
    throw new Error(
      `ChannelAdapter '${adapter.providerKey}' is missing required \`capabilities\` property`,
    )
  }

  for (const pair of CAPABILITY_METHOD_PAIRS) {
    const flagSet = adapter.capabilities[pair.flag] === true
    if (!flagSet) continue
    const method = (adapter as unknown as Record<string, unknown>)[pair.method]
    if (typeof method !== 'function') {
      throw new Error(
        `ChannelAdapter '${adapter.providerKey}' declares capabilities.${String(pair.flag)}=true but does not implement ${String(pair.method)}()`,
      )
    }
  }
}
