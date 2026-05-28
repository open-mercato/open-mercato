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
    // Spec A: pass OAuth client via the new `oauthClient` field
    // (resolved by the hub from `oauth_microsoft` integration credentials).
    const result = await getMicrosoftChannelAdapter().refreshCredentials!({
      channelId: 'channel-1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      oauthClient: {
        clientId: clientCredentials.clientId,
        clientSecret: clientCredentials.clientSecret,
        tenantId: clientCredentials.tenantId,
      },
    })
    expect((result.credentials as { accessToken: string }).accessToken).toBe('refreshed-access')
    expect((result.credentials as { refreshToken: string }).refreshToken).toBe('rotated-refresh')
  })

  it('refreshCredentials throws requires_reauth when refresh token is missing', async () => {
    setMicrosoftOAuthClient(stubOAuth({}))
    await expect(
      getMicrosoftChannelAdapter().refreshCredentials!({
        channelId: 'channel-1',
        credentials: { accessToken: 'a' },
        scope: { tenantId: 't', organizationId: 'o' },
        oauthClient: {
          clientId: clientCredentials.clientId,
          clientSecret: clientCredentials.clientSecret,
          tenantId: clientCredentials.tenantId,
        },
      }),
    ).rejects.toThrow(/requires_reauth/)
  })

  // Spec A regression coverage — the new oauthClient path is the canonical
  // production wiring; the legacy _client path remains for one minor
  // release for backward compatibility.
  describe('refreshCredentials — OAuth client wiring (Spec A)', () => {
    it('refreshes successfully when oauthClient is provided (no _client on credentials)', async () => {
      const refreshCalls: Array<{ clientId: string; clientSecret?: string; tenantId?: string; refreshToken: string }> = []
      setMicrosoftOAuthClient(
        stubOAuth({
          refreshToken: async (input) => {
            refreshCalls.push(input)
            return { access_token: 'new-access', expires_in: 1800, token_type: 'Bearer' }
          },
        }),
      )
      await getMicrosoftChannelAdapter().refreshCredentials!({
        channelId: 'channel-1',
        credentials: userCredentials, // NO _client pre-packing
        scope: { tenantId: 't', organizationId: 'o' },
        oauthClient: {
          clientId: 'oauth-cid',
          clientSecret: 'oauth-secret',
          tenantId: 'common',
        },
      })
      expect(refreshCalls).toHaveLength(1)
      expect(refreshCalls[0].clientId).toBe('oauth-cid')
      expect(refreshCalls[0].clientSecret).toBe('oauth-secret')
      expect(refreshCalls[0].tenantId).toBe('common')
      expect(refreshCalls[0].refreshToken).toBe(userCredentials.refreshToken)
    })

    it('falls back to legacy _client path with a deprecation warning when oauthClient is absent', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        setMicrosoftOAuthClient(
          stubOAuth({
            refreshToken: async () => ({ access_token: 'a', expires_in: 1800, token_type: 'Bearer' }),
          }),
        )
        await getMicrosoftChannelAdapter().refreshCredentials!({
          channelId: 'channel-1',
          credentials: { ...userCredentials, _client: clientCredentials },
          scope: { tenantId: 't', organizationId: 'o' },
        })
        // Legacy path emits a one-time deprecation warning per process.
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('reading OAuth client config from credentials._client is deprecated'),
        )
      } finally {
        warn.mockRestore()
      }
    })

    it('throws a clear error when neither oauthClient nor _client carries client config', async () => {
      setMicrosoftOAuthClient(stubOAuth({}))
      await expect(
        getMicrosoftChannelAdapter().refreshCredentials!({
          channelId: 'channel-1',
          credentials: userCredentials, // NO _client, NO oauthClient
          scope: { tenantId: 't', organizationId: 'o' },
        }),
      ).rejects.toThrow(/Invalid Microsoft OAuth client credentials/)
    })
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

describe('MicrosoftChannelAdapter push methods (Spec C)', () => {
  it('exposes registerPush, unregisterPush, applyPushNotification', () => {
    const adapter = getMicrosoftChannelAdapter()
    expect(typeof adapter.registerPush).toBe('function')
    expect(typeof adapter.unregisterPush).toBe('function')
    expect(typeof adapter.applyPushNotification).toBe('function')
  })

  it('registerPush creates a Graph subscription and returns active state', async () => {
    const createCalls: Array<Record<string, unknown>> = []
    setGraphApiClient({
      ...emptyGraph(),
      createSubscription: async (_auth, input) => {
        createCalls.push(input as unknown as Record<string, unknown>)
        return {
          id: 'sub-42',
          resource: input.resource,
          changeType: input.changeType,
          clientState: input.clientState,
          notificationUrl: input.notificationUrl,
          expirationDateTime: input.expirationDateTime,
        }
      },
    })
    const adapter = getMicrosoftChannelAdapter()
    const result = await adapter.registerPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      notificationUrl: 'https://app.example.com/api/communication_channels/webhooks/microsoft/sub-42',
      lifecycleNotificationUrl: 'https://app.example.com/api/communication_channels/webhooks/microsoft/sub-42/lifecycle',
      providerConfig: { clientState: 'cs-nonce-32-bytes-base64url' },
    })
    expect(result.status).toBe('active')
    expect(result.channelStatePatch.subscriptionId).toBe('sub-42')
    expect(result.channelStatePatch.pushStatus).toBe('active')
    expect(result.recommendedPollIntervalSeconds).toBe(1800)
    expect(createCalls[0].resource).toBe("/me/mailFolders('inbox')/messages")
    expect(createCalls[0].clientState).toBe('cs-nonce-32-bytes-base64url')
  })

  it('registerPush returns failed status when clientState is missing', async () => {
    setGraphApiClient(emptyGraph())
    const adapter = getMicrosoftChannelAdapter()
    const result = await adapter.registerPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      notificationUrl: 'https://app.example.com/webhook',
      providerConfig: {},
    })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('missing_client_state')
  })

  it('registerPush reports failure for GraphApiError', async () => {
    setGraphApiClient({
      ...emptyGraph(),
      createSubscription: async () => {
        throw new GraphApiError('forbidden', 403, 'forbidden')
      },
    })
    const adapter = getMicrosoftChannelAdapter()
    const result = await adapter.registerPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      notificationUrl: 'https://app.example.com/webhook',
      providerConfig: { clientState: 'cs' },
    })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('graph_subscription_403')
  })

  it('unregisterPush calls deleteSubscription with the subscriptionId from channelState', async () => {
    const deleted: string[] = []
    setGraphApiClient({
      ...emptyGraph(),
      deleteSubscription: async (_auth, subId) => {
        deleted.push(subId)
      },
    })
    const adapter = getMicrosoftChannelAdapter()
    await adapter.unregisterPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      channelState: { subscriptionId: 'sub-42' },
    })
    expect(deleted).toEqual(['sub-42'])
  })

  it('unregisterPush is a no-op when subscriptionId is absent', async () => {
    const deleted: string[] = []
    setGraphApiClient({
      ...emptyGraph(),
      deleteSubscription: async (_auth, subId) => {
        deleted.push(subId)
      },
    })
    const adapter = getMicrosoftChannelAdapter()
    await adapter.unregisterPush!({
      channelId: 'c1',
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      channelState: {},
    })
    expect(deleted).toEqual([])
  })

  it('unregisterPush swallows 404 from deleteSubscription', async () => {
    setGraphApiClient({
      ...emptyGraph(),
      deleteSubscription: async () => {
        throw new GraphApiError('not found', 404, 'not found')
      },
    })
    const adapter = getMicrosoftChannelAdapter()
    await expect(
      adapter.unregisterPush!({
        channelId: 'c1',
        credentials: userCredentials,
        scope: { tenantId: 't', organizationId: 'o' },
        channelState: { subscriptionId: 'sub-x' },
      }),
    ).resolves.toBeUndefined()
  })

  it('applyPushNotification delegates to fetchHistory and returns a HistoryPage', async () => {
    setGraphApiClient(emptyGraph())
    const adapter = getMicrosoftChannelAdapter()
    const page = await adapter.applyPushNotification!({
      credentials: userCredentials,
      scope: { tenantId: 't', organizationId: 'o' },
      channelState: {},
      notification: { subscriptionId: 'sub-1', changeType: 'created', resource: '/me/messages' },
    })
    expect(Array.isArray(page.messages)).toBe(true)
  })
})

function emptyGraph(): GraphApiClient {
  return {
    inboxDelta: async () => ({ value: [] }),
    getMessageMime: async () => Buffer.alloc(0),
    sendMail: async () => undefined,
    getProfile: async () => ({ id: 'p', mail: 'alice@outlook.com' }),
    deleteMessage: async () => undefined,
    createSubscription: async (_auth, input) => ({
      id: 'sub-1',
      resource: input.resource,
      changeType: input.changeType,
      clientState: input.clientState,
      notificationUrl: input.notificationUrl,
      expirationDateTime: input.expirationDateTime,
    }),
    renewSubscription: async (_auth, subId, exp) => ({
      id: subId,
      resource: "/me/mailFolders('inbox')/messages",
      changeType: 'created',
      notificationUrl: 'https://app.example.com/webhook',
      expirationDateTime: exp,
    }),
    deleteSubscription: async () => undefined,
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
