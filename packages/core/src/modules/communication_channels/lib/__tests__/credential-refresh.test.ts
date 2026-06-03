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
const userScope = { ...scope, userId: '33333333-3333-3333-3333-333333333333' }

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

  // Spec A regression coverage — the helper MUST resolve the tenant's OAuth
  // client config from the `channel_<provider>` integration at TENANT scope
  // (userId = null) and pass it to the adapter via
  // `RefreshCredentialsInput.oauthClient`. The client app config lives under the
  // SAME `channel_<provider>` id the admin configures in the Integrations UI;
  // the per-user row (userId set) holds the user's tokens, not the app creds.
  // Earlier code read a phantom `oauth_<provider>` id that nothing ever writes,
  // so refresh silently failed past the ~1h token mark in production.
  describe('OAuth client resolution (Spec A)', () => {
    it('resolves tenant channel_<provider> credentials (userId=null) even when refreshing a per-user channel', async () => {
      const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
      const adapter = makeAdapter(refresh)
      const resolve = jest.fn(async (integrationId: string) => {
        if (integrationId === 'channel_test') {
          return {
            clientId: 'gmail-client-id',
            clientSecret: 'gmail-secret',
            scopes: ['https://www.googleapis.com/auth/gmail.modify'],
          }
        }
        return null
      })
      await refreshCredentialsIfNeeded(
        {
          adapter,
          channelId: 'ch-1',
          credentials: {
            accessToken: 'a',
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
          },
          scope: userScope,
        },
        { credentialsService: { resolve } },
      )
      // Resolved at TENANT scope (userId forced to null), NOT the channel's
      // per-user scope, so the lookup hits the admin's client-app row.
      expect(resolve).toHaveBeenCalledWith('channel_test', { ...scope, userId: null })
      expect(refresh).toHaveBeenCalledTimes(1)
      const refreshArg = refresh.mock.calls[0][0]
      expect(refreshArg.scope).toEqual(userScope)
      expect(refreshArg.oauthClient).toEqual({
        clientId: 'gmail-client-id',
        clientSecret: 'gmail-secret',
        scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      })
    })

    it('passes oauthClient=undefined when the channel_<provider> client row does not exist', async () => {
      const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
      const adapter = makeAdapter(refresh)
      const resolve = jest.fn(async () => null)
      await refreshCredentialsIfNeeded(
        {
          adapter,
          channelId: 'ch-1',
          credentials: {
            accessToken: 'a',
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
          },
          scope,
        },
        { credentialsService: { resolve } },
      )
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(refresh.mock.calls[0][0].oauthClient).toBeUndefined()
    })

    it('passes oauthClient=undefined when no credentialsService is registered', async () => {
      const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
      const adapter = makeAdapter(refresh)
      await refreshCredentialsIfNeeded({
        adapter,
        channelId: 'ch-1',
        credentials: {
          accessToken: 'a',
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        },
        scope,
      })
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(refresh.mock.calls[0][0].oauthClient).toBeUndefined()
    })

    it('passes oauthClient=undefined when the oauth row is malformed (missing clientId)', async () => {
      const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
      const adapter = makeAdapter(refresh)
      const resolve = jest.fn(async () => ({ clientSecret: 'lonely-secret' }))
      await refreshCredentialsIfNeeded(
        {
          adapter,
          channelId: 'ch-1',
          credentials: {
            accessToken: 'a',
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
          },
          scope,
        },
        { credentialsService: { resolve } },
      )
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(refresh.mock.calls[0][0].oauthClient).toBeUndefined()
    })

    it('swallows credentialsService.resolve errors and treats oauthClient as undefined', async () => {
      const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
      const adapter = makeAdapter(refresh)
      const resolve = jest.fn(async () => {
        throw new Error('integration store offline')
      })
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
        { credentialsService: { resolve } },
      )
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(refresh.mock.calls[0][0].oauthClient).toBeUndefined()
      expect(result.refreshed).toBe(true)
    })
  })

  // Concurrency regression — the outbound-delivery worker runs at concurrency 10
  // in ONE process. Two concurrent sends on the same channel must NOT both call
  // `adapter.refreshCredentials`: with rotating-refresh-token providers (Gmail)
  // the second exchange invalidates the first's token and flaps the
  // channel to `requires_reauth`. An in-process single-flight keyed by channelId
  // coalesces them.
  describe('single-flight per channelId', () => {
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
      let resolveFn!: (value: T) => void
      const promise = new Promise<T>((res) => {
        resolveFn = res
      })
      return { promise, resolve: resolveFn }
    }

    it('coalesces two concurrent refreshes for the same channelId into ONE adapter call', async () => {
      const gate = deferred<{ credentials: { accessToken: string } }>()
      const refresh = jest.fn(() => gate.promise)
      const adapter = makeAdapter(refresh)
      const credentials = {
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }
      const first = refreshCredentialsIfNeeded({ adapter, channelId: 'ch-1', credentials, scope })
      const second = refreshCredentialsIfNeeded({ adapter, channelId: 'ch-1', credentials, scope })
      gate.resolve({ credentials: { accessToken: 'rotated' } })
      const [firstResult, secondResult] = await Promise.all([first, second])
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(firstResult.refreshed).toBe(true)
      expect(secondResult.refreshed).toBe(true)
      expect(firstResult.credentials.accessToken).toBe('rotated')
      expect(secondResult.credentials.accessToken).toBe('rotated')
    })

    it('refreshes DIFFERENT channelIds independently', async () => {
      const refresh = jest.fn(async (input: any) => ({
        credentials: { accessToken: `rotated:${input.channelId}` },
      }))
      const adapter = makeAdapter(refresh)
      const credentials = {
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }
      const [a, b] = await Promise.all([
        refreshCredentialsIfNeeded({ adapter, channelId: 'ch-1', credentials, scope }),
        refreshCredentialsIfNeeded({ adapter, channelId: 'ch-2', credentials, scope }),
      ])
      expect(refresh).toHaveBeenCalledTimes(2)
      expect(a.credentials.accessToken).toBe('rotated:ch-1')
      expect(b.credentials.accessToken).toBe('rotated:ch-2')
    })

    it('clears the in-flight entry so a later refresh for the same channel runs again', async () => {
      const refresh = jest.fn(async () => ({ credentials: { accessToken: 'b' } }))
      const adapter = makeAdapter(refresh)
      const credentials = {
        accessToken: 'a',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }
      await refreshCredentialsIfNeeded({ adapter, channelId: 'ch-1', credentials, scope })
      await refreshCredentialsIfNeeded({ adapter, channelId: 'ch-1', credentials, scope })
      expect(refresh).toHaveBeenCalledTimes(2)
    })
  })
})
