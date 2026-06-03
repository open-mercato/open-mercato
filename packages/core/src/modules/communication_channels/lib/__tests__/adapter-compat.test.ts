import { validateAdapterCapabilities } from '../adapter-compat'
import type { ChannelAdapter, ChannelCapabilities } from '../adapter'

function baseCapabilities(overrides: Partial<ChannelCapabilities> = {}): ChannelCapabilities {
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
    ...overrides,
  }
}

function noopAsync(): Promise<any> {
  return Promise.resolve()
}

function makeMinimalAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    providerKey: 'test',
    channelType: 'test',
    capabilities: baseCapabilities(),
    sendMessage: noopAsync as any,
    verifyWebhook: noopAsync as any,
    getStatus: noopAsync as any,
    convertOutbound: noopAsync as any,
    normalizeInbound: noopAsync as any,
    ...overrides,
  }
}

describe('validateAdapterCapabilities', () => {
  it('accepts a well-formed adapter with no optional capabilities', () => {
    const adapter = makeMinimalAdapter()
    expect(() => validateAdapterCapabilities(adapter)).not.toThrow()
  })

  it('throws when providerKey is missing', () => {
    const adapter = makeMinimalAdapter({ providerKey: '' })
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/providerKey/)
  })

  it('throws when channelType is missing', () => {
    const adapter = makeMinimalAdapter({ channelType: '' })
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/channelType/)
  })

  it('throws when capabilities is missing', () => {
    const adapter = makeMinimalAdapter()
    ;(adapter as any).capabilities = undefined
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/capabilities/)
  })

  it('throws when capabilities.reactions=true but sendReaction is missing', () => {
    const adapter = makeMinimalAdapter({
      providerKey: 'broken_reactions',
      capabilities: baseCapabilities({ reactions: true }),
      removeReaction: noopAsync as any, // partial — only removeReaction provided
    })
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/sendReaction/)
  })

  it('throws when capabilities.reactions=true but removeReaction is missing', () => {
    const adapter = makeMinimalAdapter({
      providerKey: 'broken_reactions_2',
      capabilities: baseCapabilities({ reactions: true }),
      sendReaction: noopAsync as any, // partial — only sendReaction provided
    })
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/removeReaction/)
  })

  it('accepts an adapter with reactions=true and both reaction methods implemented', () => {
    const adapter = makeMinimalAdapter({
      providerKey: 'good_reactions',
      capabilities: baseCapabilities({ reactions: true }),
      sendReaction: noopAsync as any,
      removeReaction: noopAsync as any,
    })
    expect(() => validateAdapterCapabilities(adapter)).not.toThrow()
  })

  it('throws when capabilities.editMessage=true but editMessage method is missing', () => {
    const adapter = makeMinimalAdapter({
      providerKey: 'broken_edit',
      capabilities: baseCapabilities({ editMessage: true }),
    })
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/editMessage/)
  })

  it('throws when capabilities.deleteMessage=true but deleteMessage method is missing', () => {
    const adapter = makeMinimalAdapter({
      providerKey: 'broken_delete',
      capabilities: baseCapabilities({ deleteMessage: true }),
    })
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/deleteMessage/)
  })

  it('throws when capabilities.conversationHistory=true but fetchHistory is missing', () => {
    const adapter = makeMinimalAdapter({
      providerKey: 'broken_history',
      capabilities: baseCapabilities({ conversationHistory: true }),
    })
    expect(() => validateAdapterCapabilities(adapter)).toThrow(/fetchHistory/)
  })

  it('accepts adapter with all extended capabilities + all methods', () => {
    const adapter = makeMinimalAdapter({
      providerKey: 'fully_loaded',
      capabilities: baseCapabilities({
        reactions: true,
        editMessage: true,
        deleteMessage: true,
        conversationHistory: true,
      }),
      sendReaction: noopAsync as any,
      removeReaction: noopAsync as any,
      editMessage: noopAsync as any,
      deleteMessage: noopAsync as any,
      fetchHistory: noopAsync as any,
    })
    expect(() => validateAdapterCapabilities(adapter)).not.toThrow()
  })
})
