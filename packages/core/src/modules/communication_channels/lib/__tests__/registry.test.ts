import { ChannelAdapterRegistry } from '../registry'
import type { ChannelAdapter, ChannelCapabilities } from '../adapter'

function baseCapabilities(): ChannelCapabilities {
  return {
    threading: false,
    richText: false,
    fileSharing: false,
    readReceipts: false,
    deliveryReceipts: false,
    typingIndicators: false,
    reactions: false,
    multiReactionPerUser: false,
    editMessage: false,
    deleteMessage: false,
    presence: false,
    richBlocks: false,
    interactiveComponents: false,
    inlineImages: false,
    conversationHistory: false,
    contactCards: false,
    locationSharing: false,
    voiceNotes: false,
    stickers: false,
    supportedBodyFormats: ['text'],
  }
}

function noopAsync(): Promise<any> {
  return Promise.resolve()
}

function makeAdapter(providerKey: string, channelType: string = 'test'): ChannelAdapter {
  return {
    providerKey,
    channelType,
    capabilities: baseCapabilities(),
    sendMessage: noopAsync as any,
    verifyWebhook: noopAsync as any,
    getStatus: noopAsync as any,
    convertOutbound: noopAsync as any,
    normalizeInbound: noopAsync as any,
  }
}

describe('ChannelAdapterRegistry', () => {
  let registry: ChannelAdapterRegistry

  beforeEach(() => {
    registry = new ChannelAdapterRegistry()
    // The registry is backed by a process-level `globalThis` map (so the auth-less
    // webhook route can resolve adapters without a DI scope). Reset between tests
    // so cases don't share state.
    registry.clear()
  })

  afterEach(() => {
    registry.clear()
  })

  it('starts empty', () => {
    expect(registry.list()).toEqual([])
    expect(registry.providerKeys()).toEqual([])
  })

  it('registers and retrieves an adapter by providerKey', () => {
    const adapter = makeAdapter('slack', 'slack')
    registry.register(adapter)
    expect(registry.get('slack')).toBe(adapter)
    expect(registry.has('slack')).toBe(true)
  })

  it('returns undefined for unknown providerKey', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('lists all registered adapters', () => {
    const slack = makeAdapter('slack', 'slack')
    const whatsapp = makeAdapter('whatsapp', 'whatsapp')
    registry.register(slack)
    registry.register(whatsapp)
    expect(registry.list()).toEqual(expect.arrayContaining([slack, whatsapp]))
    expect(registry.list()).toHaveLength(2)
    expect(registry.providerKeys()).toEqual(expect.arrayContaining(['slack', 'whatsapp']))
  })

  it('refuses duplicate providerKey registration', () => {
    registry.register(makeAdapter('slack', 'slack'))
    expect(() => registry.register(makeAdapter('slack', 'slack'))).toThrow(/already registered/)
  })

  it('calls validateAdapterCapabilities on register — rejects mismatched capabilities', () => {
    const adapter = makeAdapter('broken', 'broken')
    adapter.capabilities.reactions = true
    // does not implement sendReaction / removeReaction → must throw
    expect(() => registry.register(adapter)).toThrow(/sendReaction|removeReaction/)
  })

  it('clear() empties the registry', () => {
    registry.register(makeAdapter('slack', 'slack'))
    registry.register(makeAdapter('whatsapp', 'whatsapp'))
    expect(registry.list()).toHaveLength(2)
    registry.clear()
    expect(registry.list()).toEqual([])
  })

  it('allows re-registration after clear', () => {
    registry.register(makeAdapter('slack', 'slack'))
    registry.clear()
    expect(() => registry.register(makeAdapter('slack', 'slack'))).not.toThrow()
  })
})
