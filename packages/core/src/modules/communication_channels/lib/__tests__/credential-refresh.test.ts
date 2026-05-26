import { refreshCredentialsIfNeeded } from '../credential-refresh'
import type { ChannelAdapter, ChannelCapabilities } from '../adapter'

function caps(): ChannelCapabilities {
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

function makeAdapter(refresh?: (input: any) => Promise<{ credentials: any; expiresAt?: Date }>): ChannelAdapter {
  return {
    providerKey: 'test',
    channelType: 'test',
    capabilities: caps(),
    sendMessage: jest.fn() as any,
    verifyWebhook: jest.fn() as any,
    getStatus: jest.fn() as any,
    convertOutbound: jest.fn() as any,
    normalizeInbound: jest.fn() as any,
    refreshCredentials: refresh as any,
  }
}

const scope = { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: '22222222-2222-2222-2222-222222222222' }

describe('refreshCredentialsIfNeeded', () => {
  it('no-ops when adapter does not implement refreshCredentials', async () => {
    const adapter = makeAdapter()
    delete (adapter as any).refreshCredentials
    const result = await refreshCredentialsIfNeeded({
      adapter,
      channelId: 'ch-1',
      credentials: { accessToken: 'a', expiresAt: new Date(Date.now() + 1000).toISOString() },
      scope,
    })
    expect(result.refreshed).toBe(false)
    expect(result.credentials.accessToken).toBe('a')
  })

  it('no-ops when credentials lack expiresAt and not forced', async () => {
    const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
    const adapter = makeAdapter(refresh)
    const result = await refreshCredentialsIfNeeded({
      adapter,
      channelId: 'ch-1',
      credentials: { accessToken: 'a' },
      scope,
    })
    expect(result.refreshed).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes when expiresAt is within the default window (60s)', async () => {
    const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
    const adapter = makeAdapter(refresh)
    const result = await refreshCredentialsIfNeeded({
      adapter,
      channelId: 'ch-1',
      credentials: {
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
      scope,
    })
    expect(result.refreshed).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(result.credentials.accessToken).toBe('b')
  })

  it('does NOT refresh when expiresAt is comfortably in the future', async () => {
    const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
    const adapter = makeAdapter(refresh)
    const result = await refreshCredentialsIfNeeded({
      adapter,
      channelId: 'ch-1',
      credentials: {
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      scope,
    })
    expect(result.refreshed).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes when force=true, regardless of expiresAt', async () => {
    const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
    const adapter = makeAdapter(refresh)
    const result = await refreshCredentialsIfNeeded({
      adapter,
      channelId: 'ch-1',
      credentials: { accessToken: 'a' }, // no expiresAt
      scope,
      force: true,
    })
    expect(result.refreshed).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(result.credentials.accessToken).toBe('b')
  })

  it('keeps current credentials when adapter refresh throws', async () => {
    const refresh = jest.fn(async () => {
      throw new Error('boom')
    })
    const adapter = makeAdapter(refresh)
    const result = await refreshCredentialsIfNeeded({
      adapter,
      channelId: 'ch-1',
      credentials: {
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
      scope,
    })
    expect(result.refreshed).toBe(false)
    expect(result.credentials.accessToken).toBe('a')
  })

  it('persists new credentials via credentialsService.save when provided', async () => {
    const save = jest.fn(async () => undefined)
    const newExpiry = new Date(Date.now() + 3600_000)
    const refresh = jest.fn(async () => ({
      credentials: { accessToken: 'b' },
      expiresAt: newExpiry,
    }))
    const adapter = makeAdapter(refresh)
    const result = await refreshCredentialsIfNeeded(
      {
        adapter,
        channelId: 'ch-1',
        credentials: {
          accessToken: 'a',
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        },
        scope,
      },
      { credentialsService: { resolve: async () => null, save } },
    )
    expect(result.refreshed).toBe(true)
    // The real CredentialsService signature is `save(integrationId, credentials, scope)`.
    // The legacy reversed order corrupted persisted rows by writing the scope
    // object into the credentials field — review C1 (2026-05-26).
    expect(save).toHaveBeenCalledWith(
      'channel_test',
      expect.objectContaining({ accessToken: 'b', expiresAt: newExpiry.toISOString() }),
      scope,
    )
  })
})
