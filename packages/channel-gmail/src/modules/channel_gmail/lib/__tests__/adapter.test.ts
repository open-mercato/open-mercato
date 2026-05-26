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
import { getGmailChannelAdapter } from '../adapter'
import { gmailCapabilities } from '../capabilities'

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
    const result = await getGmailChannelAdapter().refreshCredentials!({
      channelId: 'channel-1',
      credentials: { ...userCredentials, _client: clientCredentials },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect((result.credentials as { accessToken: string }).accessToken).toBe('refreshed-access')
    expect((result.credentials as { refreshToken: string }).refreshToken).toBe('refresh')
  })

  it('refreshCredentials throws requires_reauth when refresh token is missing', async () => {
    setGoogleOAuthClient(stubOAuth({}))
    await expect(
      getGmailChannelAdapter().refreshCredentials!({
        channelId: 'channel-1',
        credentials: { accessToken: 'a', _client: clientCredentials },
        scope: { tenantId: 't', organizationId: 'o' },
      }),
    ).rejects.toThrow(/requires_reauth/)
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
