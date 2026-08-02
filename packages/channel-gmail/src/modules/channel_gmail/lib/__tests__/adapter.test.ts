import {
  setGmailApiClient,
  type GmailApiClient,
  type GmailGetMessageRawResponse,
  GmailApiError,
  encodeBase64Url,
} from '../gmail-client'
import {
  setGoogleOAuthClient,
  type GoogleOAuthClient,
} from '../oauth'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getGmailChannelAdapter } from '../adapter'
import { gmailCapabilities } from '../capabilities'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const adapterLoggerWarn = createLogger('channel_gmail').warn as jest.Mock

const userCredentials = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: '2026-05-26T10:00:00.000Z',
  email: 'alice@gmail.com',
}

const clientCredentials = {
  clientId: 'cid',
  clientSecret: 'secret',
  scopes: 'https://www.googleapis.com/auth/gmail.modify',
}

function buildRawMime(messageId: string, body: string): Buffer {
  return Buffer.from(
    [
      `Message-ID: <${messageId}>`,
      'From: alice@gmail.com',
      'To: bob@example.com',
      'Subject: Hello',
      'Date: Wed, 21 May 2026 10:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n'),
    'utf-8',
  )
}

afterEach(() => {
  setGmailApiClient(null)
  setGoogleOAuthClient(null)
})

describe('GmailChannelAdapter wiring', () => {
  it('exposes the right providerKey, channelType, and capabilities', () => {
    const adapter = getGmailChannelAdapter()
    expect(adapter.providerKey).toBe('gmail')
    expect(adapter.channelType).toBe('email')
    expect(adapter.capabilities).toBe(gmailCapabilities)
    expect(adapter.capabilities.realtimePush).toBe(false)
    expect(adapter.capabilities.reactions).toBe(false)
    expect(adapter.capabilities.deleteMessage).toBe(true)
  })

  it('exports the OAuth + refresh hooks but omits validateCredentials', () => {
    const adapter = getGmailChannelAdapter()
    expect(typeof adapter.buildOAuthAuthorizeUrl).toBe('function')
    expect(typeof adapter.exchangeOAuthCode).toBe('function')
    expect(typeof adapter.refreshCredentials).toBe('function')
    expect(typeof adapter.fetchHistory).toBe('function')
    expect(typeof adapter.deleteMessage).toBe('function')
    expect(adapter.validateCredentials).toBeUndefined()
    expect(adapter.sendReaction).toBeUndefined()
  })
})

describe('GmailChannelAdapter push methods (Spec C)', () => {
  function makeApi(overrides: Partial<GmailApiClient>): GmailApiClient {
    return {
      listHistory: async () => ({ historyId: '0' }),
      listMessages: async () => ({}),
      getMessageRaw: async () => ({ id: 'x', threadId: 'x', raw: '' }) as GmailGetMessageRawResponse,
      sendRawMessage: async () => ({ id: 'x', threadId: 'x' }),
      getProfile: async () => ({ emailAddress: 'alice@gmail.com', historyId: '100' }),
      trashMessage: async () => undefined,
      watchInbox: async () => ({ historyId: '200', expiration: String(Date.now() + 6 * 24 * 3600 * 1000) }),
      stopWatch: async () => undefined,
      ...overrides,
    }
  }

  it('exposes registerPush, unregisterPush, applyPushNotification', () => {
    const adapter = getGmailChannelAdapter()
    expect(typeof adapter.registerPush).toBe('function')
    expect(typeof adapter.unregisterPush).toBe('function')
    expect(typeof adapter.applyPushNotification).toBe('function')
  })

  it('registerPush returns active+state patch on success', async () => {
    const watchCalls: Array<{ topicName: string; labelIds?: string[] }> = []
    setGmailApiClient(
      makeApi({
        watchInbox: async (_auth, input) => {
          watchCalls.push(input)
          return { historyId: '999', expiration: String(Date.now() + 6 * 24 * 3600 * 1000) }
        },
      }),
    )
    const adapter = getGmailChannelAdapter()
    const result = await adapter.registerPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      notificationUrl: 'https://app.example.com/api/communication_channels/webhooks/gmail',
      providerConfig: { pubsubTopic: 'projects/p/topics/gmail-inbound' },
    })
    expect(result.status).toBe('active')
    expect(result.channelStatePatch.historyId).toBe('999')
    expect(result.channelStatePatch.pushStatus).toBe('active')
    expect(result.channelStatePatch.pubsubTopic).toBe('projects/p/topics/gmail-inbound')
    expect(result.recommendedPollIntervalSeconds).toBe(1800)
    expect(watchCalls[0].topicName).toBe('projects/p/topics/gmail-inbound')
    expect(watchCalls[0].labelIds).toEqual(['INBOX'])
  })

  it('registerPush returns failed status when topic missing', async () => {
    setGmailApiClient(makeApi({}))
    const adapter = getGmailChannelAdapter()
    const result = await adapter.registerPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      notificationUrl: 'https://app.example.com/api/communication_channels/webhooks/gmail',
      providerConfig: {},
    })
    expect(result.status).toBe('failed')
    expect(result.channelStatePatch.pushStatus).toBe('failed')
    expect(result.error?.code).toBe('missing_topic')
  })

  it('registerPush reports failed when watch throws GmailApiError', async () => {
    setGmailApiClient(
      makeApi({
        watchInbox: async () => {
          throw new GmailApiError('forbidden', 403, 'forbidden')
        },
      }),
    )
    const adapter = getGmailChannelAdapter()
    const result = await adapter.registerPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      notificationUrl: 'https://app.example.com/api/communication_channels/webhooks/gmail',
      providerConfig: { pubsubTopic: 'projects/p/topics/inbound' },
    })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('gmail_watch_403')
  })

  it('unregisterPush calls stopWatch and swallows 404', async () => {
    let stopCalls = 0
    setGmailApiClient(
      makeApi({
        stopWatch: async () => {
          stopCalls += 1
          throw new GmailApiError('no watch', 404, 'not found')
        },
      }),
    )
    const adapter = getGmailChannelAdapter()
    await adapter.unregisterPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      channelState: {},
    })
    expect(stopCalls).toBe(1)
  })

  it('unregisterPush rethrows non-404 errors', async () => {
    setGmailApiClient(
      makeApi({
        stopWatch: async () => {
          throw new GmailApiError('boom', 500, 'server')
        },
      }),
    )
    const adapter = getGmailChannelAdapter()
    await expect(
      adapter.unregisterPush!({
        channelId: 'c1',
        credentials: userCredentials,
        scope: { tenantId: 't', organizationId: 'o' },
        channelState: {},
      }),
    ).rejects.toThrow(/boom/)
  })

  it('applyPushNotification delegates to fetchHistory and returns its page', async () => {
    setGmailApiClient(
      makeApi({
        // No historyId in channelState → bootstrap branch returns 0 messages
        // (matches Spec B § Gmail bootstrap behavior).
        getProfile: async () => ({ emailAddress: 'alice@gmail.com', historyId: '500' }),
      }),
    )
    const adapter = getGmailChannelAdapter()
    const page = await adapter.applyPushNotification!({
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      channelState: {},
      notification: { emailAddress: 'alice@gmail.com', historyId: '500' },
    })
    expect(Array.isArray(page.messages)).toBe(true)
    expect(page.hasMore).toBe(false)
  })
})

describe('GmailChannelAdapter.deleteMessage', () => {
  it('moves a Gmail message to trash via gmail.users.messages.trash', async () => {
    const trashed: string[] = []
    const api: GmailApiClient = {
      ...emptyApi(),
      trashMessage: async (_auth, messageId) => {
        trashed.push(messageId)
      },
    }
    setGmailApiClient(api)
    await getGmailChannelAdapter().deleteMessage!({
      externalMessageId: 'gm-msg-42',
      conversationId: 'gm-thread-1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(trashed).toEqual(['gm-msg-42'])
  })
})

describe('GmailChannelAdapter.sendMessage', () => {
  it('encodes RFC2822 + threadId and posts to gmail.users.messages.send', async () => {
    const sent: Array<{ rawBase64Url: string; threadId?: string }> = []
    const api: GmailApiClient = {
      listHistory: async () => ({ historyId: '0' }),
      listMessages: async () => ({}),
      getMessageRaw: async () => ({ id: '', threadId: '', raw: '' }),
      sendRawMessage: async (_auth, input) => {
        sent.push({ rawBase64Url: input.rawBase64Url, threadId: input.threadId })
        return { id: 'gm-out-1', threadId: 'gm-thread-out', labelIds: ['SENT'] }
      },
      getProfile: async () => ({ emailAddress: 'alice@gmail.com', historyId: '1' }),
      trashMessage: async () => undefined,
    }
    setGmailApiClient(api)
    const adapter = getGmailChannelAdapter()
    const result = await adapter.sendMessage({
      content: { html: '<p>hi</p>', bodyFormat: 'html' },
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: { to: ['bob@example.com'], subject: 'Hi', gmailThreadId: 'gm-thread-1' },
    })
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toMatch(/^<[^@]+@gmail\.com>$/)
    expect(result.conversationId).toBe('gm-thread-out')
    expect(sent).toHaveLength(1)
    expect(sent[0].threadId).toBe('gm-thread-1')
    // Decoded raw should contain our headers + body.
    const decoded = Buffer.from(
      sent[0].rawBase64Url.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (sent[0].rawBase64Url.length % 4)) % 4),
      'base64',
    ).toString('utf-8')
    expect(decoded).toContain('To: bob@example.com')
    expect(decoded).toContain('<p>hi</p>')
  })

  it('returns failed when send returns 401 (token expired)', async () => {
    setGmailApiClient({
      listHistory: async () => ({ historyId: '0' }),
      listMessages: async () => ({}),
      getMessageRaw: async () => ({ id: '', threadId: '', raw: '' }),
      sendRawMessage: async () => {
        throw new GmailApiError('Gmail API POST /send failed: token expired', 401, 'token expired')
      },
      getProfile: async () => ({ emailAddress: '', historyId: '0' }),
      trashMessage: async () => undefined,
    })
    const result = await getGmailChannelAdapter().sendMessage({
      content: { text: 'hi', bodyFormat: 'text' },
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: { to: ['bob@example.com'] },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('requires_reauth')
  })

  it('returns failed when no recipients', async () => {
    setGmailApiClient({
      listHistory: async () => ({ historyId: '0' }),
      listMessages: async () => ({}),
      getMessageRaw: async () => ({ id: '', threadId: '', raw: '' }),
      sendRawMessage: async () => ({ id: '', threadId: '' }),
      getProfile: async () => ({ emailAddress: '', historyId: '0' }),
      trashMessage: async () => undefined,
    })
    const result = await getGmailChannelAdapter().sendMessage({
      content: { text: 'hi', bodyFormat: 'text' },
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: {},
    })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/at least one recipient/i)
  })
})

describe('GmailChannelAdapter OAuth flow', () => {
  it('buildOAuthAuthorizeUrl delegates to the OAuth client + persists scopes in extra', async () => {
    setGoogleOAuthClient(stubOAuth({ buildAuthorizeUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth?...&state=s' }))
    const adapter = getGmailChannelAdapter()
    const result = await adapter.buildOAuthAuthorizeUrl!({
      state: 's',
      nonce: 'n',
      redirectUri: 'https://example.com/cb',
      credentials: clientCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      loginHint: 'alice@example.com',
    })
    expect(result.authorizeUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Array.isArray(result.extra?.scopes)).toBe(true)
  })

  it('exchangeOAuthCode persists tokens + fetches user email', async () => {
    setGoogleOAuthClient(
      stubOAuth({
        exchangeCode: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/gmail.modify',
          token_type: 'Bearer',
        }),
        fetchUserInfo: async () => ({ email: 'alice@gmail.com', name: 'Alice' }),
      }),
    )
    const result = await getGmailChannelAdapter().exchangeOAuthCode!({
      code: 'code-1',
      redirectUri: 'https://example.com/cb',
      credentials: clientCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result.externalIdentifier).toBe('alice@gmail.com')
    expect(result.displayName).toBe('Alice')
    expect((result.credentials as { accessToken: string }).accessToken).toBe('new-access')
    expect((result.credentials as { refreshToken: string }).refreshToken).toBe('new-refresh')
  })

  it('refreshCredentials keeps the existing refresh token when Google does not return a new one', async () => {
    setGoogleOAuthClient(
      stubOAuth({
        refreshToken: async () => ({
          access_token: 'refreshed-access',
          expires_in: 1800,
          token_type: 'Bearer',
          // No refresh_token in response — common case.
        }),
      }),
    )
    // Spec A: pass OAuth client via the new `oauthClient` field
    // (resolved by the hub from `oauth_gmail` integration credentials).
    const result = await getGmailChannelAdapter().refreshCredentials!({
      channelId: 'channel-1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      oauthClient: {
        clientId: clientCredentials.clientId,
        clientSecret: clientCredentials.clientSecret,
      },
    })
    expect((result.credentials as { accessToken: string }).accessToken).toBe('refreshed-access')
    expect((result.credentials as { refreshToken: string }).refreshToken).toBe('refresh')
  })

  it('refreshCredentials throws requires_reauth when refresh token is missing', async () => {
    setGoogleOAuthClient(stubOAuth({}))
    await expect(
      getGmailChannelAdapter().refreshCredentials!({
        channelId: 'channel-1',
        credentials: { accessToken: 'a' },
        scope: { tenantId: 't', organizationId: 'o' },
        oauthClient: {
          clientId: clientCredentials.clientId,
          clientSecret: clientCredentials.clientSecret,
        },
      }),
    ).rejects.toThrow(/requires_reauth/)
  })

  // Spec A regression coverage — the new oauthClient path is the canonical
  // production wiring; the legacy _client path remains for one minor
  // release for backward compatibility.
  describe('refreshCredentials — OAuth client wiring (Spec A)', () => {
    it('refreshes successfully when oauthClient is provided (no _client on credentials)', async () => {
      const refreshCalls: Array<{ clientId: string; clientSecret: string; refreshToken: string }> = []
      setGoogleOAuthClient(
        stubOAuth({
          refreshToken: async (input) => {
            refreshCalls.push(input)
            return { access_token: 'new-access', expires_in: 1800, token_type: 'Bearer' }
          },
        }),
      )
      await getGmailChannelAdapter().refreshCredentials!({
        channelId: 'channel-1',
        credentials: userCredentials, // NO _client pre-packing
        scope: { tenantId: 't', organizationId: 'o' },
        oauthClient: {
          clientId: 'oauth-cid',
          clientSecret: 'oauth-secret',
        },
      })
      expect(refreshCalls).toEqual([
        {
          clientId: 'oauth-cid',
          clientSecret: 'oauth-secret',
          refreshToken: 'refresh',
        },
      ])
    })

    it('falls back to legacy _client path with a deprecation warning when oauthClient is absent', async () => {
      adapterLoggerWarn.mockClear()
      setGoogleOAuthClient(
        stubOAuth({
          refreshToken: async () => ({ access_token: 'a', expires_in: 1800, token_type: 'Bearer' }),
        }),
      )
      await getGmailChannelAdapter().refreshCredentials!({
        channelId: 'channel-1',
        credentials: { ...userCredentials, _client: clientCredentials },
        scope: { tenantId: 't', organizationId: 'o' },
      })
      // Legacy path emits a one-time deprecation warning per process.
      expect(adapterLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('reading OAuth client config from credentials._client is deprecated'),
      )
    })

    it('throws a clear error when neither oauthClient nor _client carries client config', async () => {
      setGoogleOAuthClient(stubOAuth({}))
      await expect(
        getGmailChannelAdapter().refreshCredentials!({
          channelId: 'channel-1',
          credentials: userCredentials, // NO _client, NO oauthClient
          scope: { tenantId: 't', organizationId: 'o' },
        }),
      ).rejects.toThrow(/Invalid Gmail OAuth client credentials/)
    })
  })
})

describe('GmailChannelAdapter.fetchHistory', () => {
  it('bootstrap path: records profile.historyId and returns no messages', async () => {
    const api: GmailApiClient = {
      ...emptyApi(),
      getProfile: async () => ({ emailAddress: 'alice@gmail.com', historyId: '100' }),
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(page.messages).toHaveLength(0)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.historyId).toBe('100')
  })

  it('incremental path: fetches added message bodies and updates the cursor', async () => {
    const api: GmailApiClient = {
      ...emptyApi(),
      listHistory: async () => ({
        history: [
          {
            id: '200',
            messagesAdded: [{ message: { id: 'gm-1', threadId: 'gm-t-1', labelIds: ['INBOX'] } }],
          },
        ],
        historyId: '201',
      }),
      getMessageRaw: async (_auth, id) => buildRawResponse(id, 'gm-t-1'),
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { historyId: '100' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].externalConversationId).toBe('gmail-thread:gm-t-1')
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.historyId).toBe('201')
  })

  it('falls back to messages.list when history returns 404 (expired cursor)', async () => {
    const api: GmailApiClient = {
      ...emptyApi(),
      listHistory: async () => {
        throw new GmailApiError('history expired', 404, 'history expired')
      },
      listMessages: async () => ({
        messages: [
          { id: 'gm-2', threadId: 'gm-t-2' },
          { id: 'gm-3', threadId: 'gm-t-3' },
        ],
      }),
      getMessageRaw: async (_auth, id) => buildRawResponse(id, `gm-t-${id.slice(-1)}`),
      getProfile: async () => ({ emailAddress: 'alice@gmail.com', historyId: '999' }),
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { historyId: '100' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(page.messages).toHaveLength(2)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.historyId).toBe('999')
  })

  it('L3: a transient getMessageRaw failure does not advance the cursor past unprocessed messages', async () => {
    const api: GmailApiClient = {
      ...emptyApi(),
      listHistory: async () => ({
        history: [
          {
            id: '200',
            messagesAdded: [
              { message: { id: 'gm-1', threadId: 'gm-t-1', labelIds: ['INBOX'] } },
              { message: { id: 'gm-2', threadId: 'gm-t-2', labelIds: ['INBOX'] } },
            ],
          },
        ],
        historyId: '201',
      }),
      getMessageRaw: async (_auth, id) => {
        if (id === 'gm-2') throw new GmailApiError('server boom', 500, 'server')
        return buildRawResponse(id, 'gm-t-1')
      },
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { historyId: '100' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    // Only the message normalized BEFORE the failure is returned.
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].externalConversationId).toBe('gmail-thread:gm-t-1')
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    // Cursor stays pinned to the start historyId — it must NOT advance to 201
    // and skip the failed message.
    expect(decoded.historyId).toBe('100')
    // hub re-enqueues immediately so the failed message is retried next tick.
    expect(page.hasMore).toBe(true)
  })

  it('multi-page drain: walks nextPageToken across pages without dropping messages', async () => {
    const api: GmailApiClient = {
      ...emptyApi(),
      listHistory: async (_auth, params) => {
        if (params?.pageToken === 'page-2') {
          return {
            history: [{ id: '202', messagesAdded: [{ message: { id: 'gm-2', threadId: 'gm-t-2', labelIds: ['INBOX'] } }] }],
            historyId: '203',
          }
        }
        return {
          history: [{ id: '200', messagesAdded: [{ message: { id: 'gm-1', threadId: 'gm-t-1', labelIds: ['INBOX'] } }] }],
          historyId: '201',
          nextPageToken: 'page-2',
        }
      },
      getMessageRaw: async (_auth, id) => buildRawResponse(id, `gm-t-${id.slice(-1)}`),
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { historyId: '100' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(page.messages.map((m) => m.externalConversationId).sort()).toEqual([
      'gmail-thread:gm-t-1',
      'gmail-thread:gm-t-2',
    ])
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.historyId).toBe('203')
    expect(page.hasMore).toBe(false)
  })

  it('per-page overflow: a single page carrying more refs than the limit drops none', async () => {
    const api: GmailApiClient = {
      ...emptyApi(),
      listHistory: async () => ({
        history: [
          {
            id: '200',
            messagesAdded: [
              { message: { id: 'gm-1', threadId: 'gm-t-1', labelIds: ['INBOX'] } },
              { message: { id: 'gm-2', threadId: 'gm-t-2', labelIds: ['INBOX'] } },
              { message: { id: 'gm-3', threadId: 'gm-t-3', labelIds: ['INBOX'] } },
            ],
          },
        ],
        historyId: '201',
      }),
      getMessageRaw: async (_auth, id) => buildRawResponse(id, `gm-t-${id.slice(-1)}`),
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      limit: 2,
      ...({ channelState: { historyId: '100' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(page.messages).toHaveLength(3)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.historyId).toBe('201')
  })

  it('L3 across pages: a transient failure restarts the window without a forward page-token skip', async () => {
    const api: GmailApiClient = {
      ...emptyApi(),
      listHistory: async (_auth, params) => {
        if (params?.pageToken === 'page-2') {
          return {
            history: [{ id: '202', messagesAdded: [{ message: { id: 'gm-2', threadId: 'gm-t-2', labelIds: ['INBOX'] } }] }],
            historyId: '203',
          }
        }
        return {
          history: [{ id: '200', messagesAdded: [{ message: { id: 'gm-1', threadId: 'gm-t-1', labelIds: ['INBOX'] } }] }],
          historyId: '201',
          nextPageToken: 'page-2',
        }
      },
      getMessageRaw: async (_auth, id) => {
        if (id === 'gm-2') throw new GmailApiError('server boom', 500, 'server')
        return buildRawResponse(id, 'gm-t-1')
      },
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { historyId: '100' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(page.messages).toHaveLength(1)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.historyId).toBe('100')
    expect(decoded.pendingHistoryPageToken).toBeUndefined()
    expect(page.hasMore).toBe(true)
  })

  it('L3 first-page retry: a pinned history snapshot (no page token) re-enters the fallback scan instead of bootstrapping', async () => {
    const listCalls: Array<{ labelIds?: string[]; pageToken?: string }> = []
    let getProfileCalls = 0
    const api: GmailApiClient = {
      ...emptyApi(),
      getProfile: async () => {
        getProfileCalls += 1
        return { emailAddress: 'alice@gmail.com', historyId: '999' }
      },
      listMessages: async (_auth, params) => {
        listCalls.push(params ?? {})
        return {
          messages: [
            { id: 'gm-2', threadId: 'gm-t-2' },
            { id: 'gm-3', threadId: 'gm-t-3' },
          ],
        }
      },
      getMessageRaw: async (_auth, id) => buildRawResponse(id, `gm-t-${id.slice(-1)}`),
    }
    setGmailApiClient(api)
    const page = await getGmailChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { pendingMessagesHistoryIdSnapshot: '555' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    // Re-enters the messages.list fallback scan from the first INBOX page...
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0].labelIds).toEqual(['INBOX'])
    expect(listCalls[0].pageToken).toBeUndefined()
    expect(page.messages).toHaveLength(2)
    // ...and does NOT re-bootstrap (no profile fetch, snapshot preserved as the cursor).
    expect(getProfileCalls).toBe(0)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.historyId).toBe('555')
  })

  it('L3 first-page retry: a hard-failed first fallback page is retried on the next tick, not skipped via bootstrap', async () => {
    let listCalls = 0
    let getProfileCalls = 0
    const api: GmailApiClient = {
      ...emptyApi(),
      listHistory: async () => {
        throw new GmailApiError('history expired', 404, 'history expired')
      },
      getProfile: async () => {
        getProfileCalls += 1
        return { emailAddress: 'alice@gmail.com', historyId: '999' }
      },
      listMessages: async () => {
        listCalls += 1
        return {
          messages: [
            { id: 'gm-1', threadId: 'gm-t-1' },
            { id: 'gm-2', threadId: 'gm-t-2' },
          ],
        }
      },
      getMessageRaw: async (_auth, id) => {
        if (id === 'gm-2') throw new GmailApiError('server boom', 500, 'server')
        return buildRawResponse(id, 'gm-t-1')
      },
    }
    setGmailApiClient(api)
    const adapter = getGmailChannelAdapter()
    // Tick 1: history.list 404 → first fallback page hard-fails on gm-2. Only
    // the snapshot is pinned; the cursor must NOT advance past the unprocessed
    // messages.
    const first = await adapter.fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { historyId: '100' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(first.messages).toHaveLength(1)
    expect(first.hasMore).toBe(true)
    const firstDecoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64').toString('utf-8'))
    expect(firstDecoded.historyId).toBeUndefined()
    expect(firstDecoded.pendingMessagesPageToken).toBeUndefined()
    expect(firstDecoded.pendingMessagesHistoryIdSnapshot).toBe('999')
    const listAfterFirst = listCalls
    const profileAfterFirst = getProfileCalls
    // Tick 2: feed the orphaned cursor back in. It must re-enter the fallback
    // scan (listMessages called again) rather than bootstrap (getProfile must
    // NOT be called again).
    const second = await adapter.fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: firstDecoded } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getGmailChannelAdapter>['fetchHistory']>>[0])
    expect(listCalls).toBe(listAfterFirst + 1)
    expect(getProfileCalls).toBe(profileAfterFirst)
    expect(second.messages).toHaveLength(1)
  })
})

describe('GmailChannelAdapter.normalizeInbound + verifyWebhook + resolveContact', () => {
  it('normalizeInbound accepts rawBase64Url payloads', async () => {
    const mime = buildRawMime('msg-1', 'hello')
    const result = await getGmailChannelAdapter().normalizeInbound({
      raw: {
        rawBase64Url: encodeBase64Url(mime),
        gmailMessageId: 'gm-1',
        gmailThreadId: 'gm-t-1',
        accountIdentifier: 'alice@gmail.com',
      },
      eventType: 'message',
    })
    expect(result.externalMessageId).toBe('msg-1')
    expect(result.externalConversationId).toBe('gmail-thread:gm-t-1')
  })

  it('verifyWebhook returns a non-message event', async () => {
    const event = await getGmailChannelAdapter().verifyWebhook({
      rawBody: '',
      headers: {},
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(event.eventType).toBe('other')
  })

  it('resolveContact returns email hint for email-shaped identifiers', async () => {
    const hint = await getGmailChannelAdapter().resolveContact!({
      senderIdentifier: 'eve@example.com',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(hint).toEqual({ email: 'eve@example.com', displayName: undefined })
  })
})

function emptyApi(): GmailApiClient {
  return {
    listHistory: async () => ({ historyId: '0' }),
    listMessages: async () => ({}),
    getMessageRaw: async () => ({ id: '', threadId: '', raw: '' }),
    sendRawMessage: async () => ({ id: '', threadId: '' }),
    getProfile: async () => ({ emailAddress: '', historyId: '0' }),
    trashMessage: async () => undefined,
  }
}

function buildRawResponse(id: string, threadId: string): GmailGetMessageRawResponse {
  return {
    id,
    threadId,
    raw: encodeBase64Url(buildRawMime(`${id}@example.com`, `body ${id}`)),
    labelIds: ['INBOX'],
    internalDate: String(Date.now()),
  }
}

function stubOAuth(overrides: Partial<GoogleOAuthClient>): GoogleOAuthClient {
  return {
    buildAuthorizeUrl: overrides.buildAuthorizeUrl ?? (() => 'https://accounts.google.com/o/oauth2/v2/auth'),
    exchangeCode:
      overrides.exchangeCode ??
      (async () => ({ access_token: 'x', token_type: 'Bearer' })),
    refreshToken:
      overrides.refreshToken ??
      (async () => ({ access_token: 'x', token_type: 'Bearer' })),
    fetchUserInfo: overrides.fetchUserInfo ?? (async () => ({})),
  }
}
