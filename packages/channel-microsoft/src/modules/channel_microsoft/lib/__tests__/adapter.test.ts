import {
  setGraphApiClient,
  type GraphApiClient,
  type GraphMessage,
  GraphApiError,
} from '../graph-client'
import {
  setMicrosoftOAuthClient,
  type MicrosoftOAuthClient,
} from '../oauth'
import { getMicrosoftChannelAdapter } from '../adapter'
import { microsoftCapabilities } from '../capabilities'

const userCredentials = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: '2026-05-26T10:00:00.000Z',
  email: 'alice@outlook.com',
}

const clientCredentials = {
  clientId: 'cid',
  tenantId: 'common',
  scopes: 'Mail.Read Mail.Send',
}

function buildIdToken(payload: Record<string, unknown>): string {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=+$/, '')
  return `h.${b}.s`
}

afterEach(() => {
  setGraphApiClient(null)
  setMicrosoftOAuthClient(null)
})

describe('MicrosoftChannelAdapter wiring', () => {
  it('exposes the right providerKey, channelType, and capabilities', () => {
    const adapter = getMicrosoftChannelAdapter()
    expect(adapter.providerKey).toBe('microsoft')
    expect(adapter.channelType).toBe('email')
    expect(adapter.capabilities).toBe(microsoftCapabilities)
    expect(adapter.capabilities.realtimePush).toBe(false)
    expect(adapter.capabilities.deleteMessage).toBe(true)
    expect(adapter.capabilities.reactions).toBe(false)
  })

  it('exports OAuth + refresh hooks; omits validateCredentials and reactions', () => {
    const adapter = getMicrosoftChannelAdapter()
    expect(typeof adapter.buildOAuthAuthorizeUrl).toBe('function')
    expect(typeof adapter.exchangeOAuthCode).toBe('function')
    expect(typeof adapter.refreshCredentials).toBe('function')
    expect(typeof adapter.fetchHistory).toBe('function')
    expect(typeof adapter.deleteMessage).toBe('function')
    expect(adapter.validateCredentials).toBeUndefined()
    expect(adapter.sendReaction).toBeUndefined()
  })
})

describe('MicrosoftChannelAdapter.sendMessage', () => {
  it('POSTs a Graph sendMail body with saveToSentItems (no read-only conversationId in request)', async () => {
    const sent: unknown[] = []
    const api: GraphApiClient = {
      ...emptyGraph(),
      sendMail: async (_auth, input) => {
        sent.push(input)
      },
    }
    setGraphApiClient(api)
    const result = await getMicrosoftChannelAdapter().sendMessage({
      content: { html: '<p>Hi</p>', bodyFormat: 'html' },
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: { to: ['bob@example.com'], subject: 'Hi', microsoftConversationId: 'conv-1' },
    })
    expect(result.status).toBe('sent')
    // We surface the conversationId on our return value as a diagnostic hint
    // for callers, sourced from the originator's metadata (not from Graph).
    expect(result.conversationId).toBe('conv-1')
    expect(result.externalMessageId).toMatch(/^<[^@]+@outlook\.com>$/)
    expect(sent).toHaveLength(1)
    const body = sent[0] as { message: { subject: string; conversationId?: string }; saveToSentItems?: boolean }
    expect(body.message.subject).toBe('Hi')
    // conversationId is read-only on the Graph Message resource — it must not
    // be present in the outbound request body.
    expect(body.message.conversationId).toBeUndefined()
    expect(body.saveToSentItems).toBe(true)
  })

  it('returns failed with requires_reauth on 401', async () => {
    setGraphApiClient({
      ...emptyGraph(),
      sendMail: async () => {
        throw new GraphApiError('Graph POST /sendMail failed: token expired', 401, 'token expired')
      },
    })
    const result = await getMicrosoftChannelAdapter().sendMessage({
      content: { text: 'hi', bodyFormat: 'text' },
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: { to: ['bob@example.com'] },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('requires_reauth')
  })

  it('returns failed when no recipients', async () => {
    setGraphApiClient(emptyGraph())
    const result = await getMicrosoftChannelAdapter().sendMessage({
      content: { text: 'hi', bodyFormat: 'text' },
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      metadata: {},
    })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/at least one recipient/i)
  })
})

describe('MicrosoftChannelAdapter OAuth flow', () => {
  it('buildOAuthAuthorizeUrl generates PKCE + persists verifier in extra', async () => {
    setMicrosoftOAuthClient(stubOAuth({ buildAuthorizeUrl: () => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=s' }))
    const result = await getMicrosoftChannelAdapter().buildOAuthAuthorizeUrl!({
      state: 's',
      nonce: 'n',
      redirectUri: 'https://example.com/cb',
      credentials: clientCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result.authorizeUrl).toContain('login.microsoftonline.com')
    expect(typeof result.extra?.codeVerifier).toBe('string')
    expect(Array.isArray(result.extra?.scopes)).toBe(true)
    expect(result.extra?.tenantId).toBe('common')
  })

  it('exchangeOAuthCode uses stateExtra.codeVerifier + harvests email/oid from id_token', async () => {
    setMicrosoftOAuthClient(
      stubOAuth({
        exchangeCode: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'Mail.Read',
          token_type: 'Bearer',
          id_token: buildIdToken({ email: 'alice@outlook.com', oid: 'guid-user', name: 'Alice' }),
        }),
      }),
    )
    const result = await getMicrosoftChannelAdapter().exchangeOAuthCode!({
      code: 'code',
      redirectUri: 'https://example.com/cb',
      credentials: clientCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      stateExtra: { codeVerifier: 'verifier', tenantId: 'common' },
    })
    expect(result.externalIdentifier).toBe('alice@outlook.com')
    expect(result.displayName).toBe('Alice')
    expect((result.credentials as { accessToken: string }).accessToken).toBe('new-access')
    expect((result.credentials as { oid: string }).oid).toBe('guid-user')
  })

  it('exchangeOAuthCode throws when stateExtra.codeVerifier is missing', async () => {
    setMicrosoftOAuthClient(stubOAuth({}))
    await expect(
      getMicrosoftChannelAdapter().exchangeOAuthCode!({
        code: 'code',
        redirectUri: 'https://example.com/cb',
        credentials: clientCredentials,
        scope: { tenantId: 't', organizationId: 'o' },
      }),
    ).rejects.toThrow(/PKCE codeVerifier/i)
  })

  it('refreshCredentials rotates the refresh token when Microsoft returns a new one', async () => {
    setMicrosoftOAuthClient(
      stubOAuth({
        refreshToken: async () => ({
          access_token: 'refreshed-access',
          refresh_token: 'rotated-refresh',
          expires_in: 1800,
          token_type: 'Bearer',
        }),
      }),
    )
    const result = await getMicrosoftChannelAdapter().refreshCredentials!({
      channelId: 'channel-1',
      credentials: { ...userCredentials, _client: clientCredentials },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect((result.credentials as { accessToken: string }).accessToken).toBe('refreshed-access')
    expect((result.credentials as { refreshToken: string }).refreshToken).toBe('rotated-refresh')
  })

  it('refreshCredentials throws requires_reauth when refresh token is missing', async () => {
    setMicrosoftOAuthClient(stubOAuth({}))
    await expect(
      getMicrosoftChannelAdapter().refreshCredentials!({
        channelId: 'channel-1',
        credentials: { accessToken: 'a', _client: clientCredentials },
        scope: { tenantId: 't', organizationId: 'o' },
      }),
    ).rejects.toThrow(/requires_reauth/)
  })
})

describe('MicrosoftChannelAdapter.fetchHistory', () => {
  it('bootstrap: calls /me/mailFolders/inbox/messages/delta and persists the deltaLink', async () => {
    const calls: Array<string | undefined> = []
    const api: GraphApiClient = {
      ...emptyGraph(),
      inboxDelta: async (_auth, link) => {
        calls.push(link)
        return {
          value: [buildGraphMessage('m1')],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
        }
      },
    }
    setGraphApiClient(api)
    const page = await getMicrosoftChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    } as Parameters<NonNullable<ReturnType<typeof getMicrosoftChannelAdapter>['fetchHistory']>>[0])
    expect(calls).toEqual([undefined])
    expect(page.messages).toHaveLength(1)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.deltaLink).toContain('deltatoken=abc')
  })

  it('incremental: re-calls the persisted deltaLink', async () => {
    const calls: Array<string | undefined> = []
    const api: GraphApiClient = {
      ...emptyGraph(),
      inboxDelta: async (_auth, link) => {
        calls.push(link)
        return {
          value: [buildGraphMessage('m2')],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=def',
        }
      },
    }
    setGraphApiClient(api)
    const page = await getMicrosoftChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { deltaLink: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getMicrosoftChannelAdapter>['fetchHistory']>>[0])
    expect(calls[0]).toContain('$deltatoken=abc')
    expect(page.messages).toHaveLength(1)
  })

  it('falls back to a fresh delta on 410 (cursor invalidated)', async () => {
    let firstCallSeen = false
    const api: GraphApiClient = {
      ...emptyGraph(),
      inboxDelta: async (_auth, link) => {
        if (link && !firstCallSeen) {
          firstCallSeen = true
          throw new GraphApiError('Graph GET /delta failed: SyncStateNotFound', 410, 'SyncStateNotFound')
        }
        return {
          value: [buildGraphMessage('m3')],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=fresh',
        }
      },
    }
    setGraphApiClient(api)
    const page = await getMicrosoftChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      ...({ channelState: { deltaLink: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=stale' } } as unknown as Record<string, unknown>),
    } as Parameters<NonNullable<ReturnType<typeof getMicrosoftChannelAdapter>['fetchHistory']>>[0])
    expect(page.messages).toHaveLength(1)
    const decoded = JSON.parse(Buffer.from(page.nextCursor!, 'base64').toString('utf-8'))
    expect(decoded.deltaLink).toContain('$deltatoken=fresh')
  })
})

describe('MicrosoftChannelAdapter.deleteMessage + verifyWebhook + resolveContact + normalizeInbound', () => {
  it('deleteMessage delegates to Graph DELETE /me/messages/{id}', async () => {
    const deleted: string[] = []
    setGraphApiClient({
      ...emptyGraph(),
      deleteMessage: async (_auth, id) => {
        deleted.push(id)
      },
    })
    await getMicrosoftChannelAdapter().deleteMessage!({
      externalMessageId: 'msg-42',
      conversationId: 'c',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(deleted).toEqual(['msg-42'])
  })

  it('verifyWebhook returns a non-message event (Graph subscriptions deferred)', async () => {
    const event = await getMicrosoftChannelAdapter().verifyWebhook({
      rawBody: '',
      headers: {},
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(event.eventType).toBe('other')
  })

  it('resolveContact returns email hint for email-shaped sender', async () => {
    const hint = await getMicrosoftChannelAdapter().resolveContact!({
      senderIdentifier: 'eve@example.com',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(hint).toEqual({ email: 'eve@example.com', displayName: undefined })
  })

  it('normalizeInbound accepts a raw Graph Message resource', async () => {
    const result = await getMicrosoftChannelAdapter().normalizeInbound({
      raw: {
        message: buildGraphMessage('m9'),
        accountIdentifier: 'alice@outlook.com',
      },
      eventType: 'message',
    })
    expect(result.externalConversationId).toBe('microsoft-conversation:conv-1')
  })
})

function emptyGraph(): GraphApiClient {
  return {
    inboxDelta: async () => ({ value: [] }),
    getMessageMime: async () => Buffer.alloc(0),
    sendMail: async () => undefined,
    getProfile: async () => ({ id: 'p', mail: 'alice@outlook.com' }),
    deleteMessage: async () => undefined,
  }
}

function buildGraphMessage(id: string): GraphMessage {
  return {
    id,
    conversationId: 'conv-1',
    internetMessageId: `<${id}@example.com>`,
    subject: `subject ${id}`,
    receivedDateTime: '2026-05-21T10:00:00.000Z',
    from: { emailAddress: { address: 'alice@outlook.com', name: 'Alice' } },
    toRecipients: [{ emailAddress: { address: 'bob@example.com' } }],
    body: { contentType: 'text', content: `body ${id}` },
  }
}

function stubOAuth(overrides: Partial<MicrosoftOAuthClient>): MicrosoftOAuthClient {
  return {
    buildAuthorizeUrl: overrides.buildAuthorizeUrl ?? (() => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'),
    exchangeCode: overrides.exchangeCode ?? (async () => ({ access_token: 'x', token_type: 'Bearer' })),
    refreshToken: overrides.refreshToken ?? (async () => ({ access_token: 'x', token_type: 'Bearer' })),
  }
}
