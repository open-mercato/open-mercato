import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildImportFilter, getMs365ChannelAdapter } from '../adapter'
import { ms365Capabilities } from '../capabilities'
import {
  GraphApiError,
  setGraphMailClient,
  type GraphDeltaPage,
  type GraphListPage,
  type GraphMailClient,
} from '../graph-client'
import { setMicrosoftOAuthClient, type MicrosoftOAuthClient } from '../oauth'

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

const loggerWarn = createLogger('channel_ms365').warn as jest.Mock

const scope = { tenantId: 't', organizationId: 'o' }

const userCredentials = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: '2026-09-04T10:00:00.000Z',
  email: 'alice@contoso.com',
  displayName: 'Alice Example',
  tenantId: 'home-tenant-guid',
}

const clientCredentials = {
  clientId: 'cid',
  clientSecret: 'secret',
  tenantId: 'organizations',
}

function buildRawMime(messageId: string, body = 'hello'): Buffer {
  return Buffer.from(
    [
      `Message-ID: <${messageId}>`,
      'From: bob@example.com',
      'To: alice@contoso.com',
      'Subject: Hello',
      'Date: Thu, 04 Sep 2026 10:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n'),
    'utf-8',
  )
}

function emptyGraph(): GraphMailClient {
  return {
    startInboxDelta: async () => ({ value: [], deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=seed' }),
    continueDelta: async () => ({ value: [], deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=next' }),
    listInboxMessages: async () => ({ value: [] }),
    continueList: async () => ({ value: [] }),
    getMessageMime: async (_auth, id) => buildRawMime(`${id}@example.com`),
    findMessageIdByInternetMessageId: async () => null,
    createDraftFromMime: async () => ({ id: 'draft-1', internetMessageId: '<sent-1@contoso.com>', conversationId: 'conv-1' }),
    sendDraft: async () => undefined,
    getMessageState: async (_auth, id) => ({ id, isDraft: true }),
    deleteMessage: async () => undefined,
    moveMessage: async () => undefined,
  }
}

function stubOAuth(overrides: Partial<MicrosoftOAuthClient>): MicrosoftOAuthClient {
  return {
    buildAuthorizeUrl: overrides.buildAuthorizeUrl ?? ((input) => `https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/authorize?state=${input.state}`),
    exchangeCode: overrides.exchangeCode ?? (async () => ({ access_token: 'at', token_type: 'Bearer' })),
    refreshToken: overrides.refreshToken ?? (async () => ({ access_token: 'at', token_type: 'Bearer' })),
    fetchProfile: overrides.fetchProfile ?? (async () => ({})),
  }
}

function decodeCursor(cursor: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor ?? '', 'base64').toString('utf-8')) as Record<string, unknown>
}

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.sig`
}

afterEach(() => {
  setGraphMailClient(null)
  setMicrosoftOAuthClient(null)
  loggerWarn.mockClear()
})

describe('Ms365ChannelAdapter wiring', () => {
  it('exposes providerKey, channelType, and capabilities', () => {
    const adapter = getMs365ChannelAdapter()
    expect(adapter.providerKey).toBe('ms365')
    expect(adapter.channelType).toBe('email')
    expect(adapter.capabilities).toBe(ms365Capabilities)
    expect(adapter.capabilities.realtimePush).toBe(false)
    expect(adapter.capabilities.deleteMessage).toBe(true)
    expect(adapter.channelScope).toBeUndefined()
  })

  it('exports the OAuth, refresh, history, import and delete hooks but omits validateCredentials and push', () => {
    const adapter = getMs365ChannelAdapter()
    expect(typeof adapter.buildOAuthAuthorizeUrl).toBe('function')
    expect(typeof adapter.exchangeOAuthCode).toBe('function')
    expect(typeof adapter.refreshCredentials).toBe('function')
    expect(typeof adapter.fetchHistory).toBe('function')
    expect(typeof adapter.importHistory).toBe('function')
    expect(typeof adapter.deleteMessage).toBe('function')
    expect(typeof adapter.resolveContact).toBe('function')
    expect(adapter.validateCredentials).toBeUndefined()
    expect(adapter.registerPush).toBeUndefined()
    expect(adapter.sendReaction).toBeUndefined()
  })

  it('convertOutbound shapes the body without requiring recipients (the hub passes them to sendMessage)', async () => {
    const native = await getMs365ChannelAdapter().convertOutbound({ body: '<p>Hi <b>there</b></p>', bodyFormat: 'html' })
    expect(native.content.html).toContain('<b>there</b>')
    expect(native.content.text).toContain('Hi')
    expect(native.content.bodyFormat).toBe('html')
  })

  it('convertOutbound passes the hub channel metadata through as metadata for sendMessage', async () => {
    // deliver-outbound-message calls convertOutbound({ channelMetadata }) and then
    // sendMessage({ metadata: converted.metadata }); recipients must survive that hop.
    const channelMetadata = {
      to: ['bob@example.com'],
      cc: ['carol@example.com'],
      subject: 'Hello',
      references: ['<ref@example.com>'],
      omThreadToken: 'tok',
      thread_id: 'outbound:abc',
    }
    const native = await getMs365ChannelAdapter().convertOutbound({
      body: 'plain body',
      bodyFormat: 'text',
      channelMetadata,
    })
    expect(native.metadata).toEqual(channelMetadata)
    expect(native.content.raw).toEqual(channelMetadata)
  })

  it('verifyWebhook returns an unhandled event and getStatus a sent placeholder', async () => {
    const adapter = getMs365ChannelAdapter()
    const webhook = await adapter.verifyWebhook({ rawBody: '', headers: {}, credentials: {}, scope })
    expect(webhook.eventType).toBe('other')
    const status = await adapter.getStatus({ externalMessageId: 'x', credentials: userCredentials, scope })
    expect(status.status).toBe('sent')
  })
})

describe('Ms365ChannelAdapter OAuth flow', () => {
  it('buildOAuthAuthorizeUrl embeds the hub state and packs the PKCE verifier + scopes + tenant into extra', async () => {
    const seen: Array<{ tenantId: string; codeChallenge: string; scopes: string[] }> = []
    setMicrosoftOAuthClient(
      stubOAuth({
        buildAuthorizeUrl: (input) => {
          seen.push({ tenantId: input.tenantId, codeChallenge: input.codeChallenge, scopes: input.scopes })
          return `https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/authorize?state=${input.state}`
        },
      }),
    )
    const result = await getMs365ChannelAdapter().buildOAuthAuthorizeUrl!({
      state: 'hub-state',
      nonce: 'n',
      redirectUri: 'https://app.example.com/api/communication_channels/oauth/ms365/callback',
      credentials: clientCredentials,
      scope,
    })
    expect(result.authorizeUrl).toContain('state=hub-state')
    expect(seen[0].tenantId).toBe('organizations')
    expect(seen[0].codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(seen[0].scopes).toContain('offline_access')
    expect(typeof result.extra?.codeVerifier).toBe('string')
    expect(result.extra?.tenantId).toBe('organizations')
    expect(Array.isArray(result.extra?.scopes)).toBe(true)
  })

  it('rejects a malformed client config with an actionable error', async () => {
    await expect(
      getMs365ChannelAdapter().buildOAuthAuthorizeUrl!({ state: 's', nonce: 'n', redirectUri: 'https://x/cb', credentials: { clientId: '' }, scope }),
    ).rejects.toThrow(/Microsoft 365 OAuth client credentials/)
  })

  it('exchangeOAuthCode sends the PKCE verifier, resolves the mailbox from Graph and keeps the home tenant', async () => {
    const exchanges: Array<{ codeVerifier: string; tenantId: string; scopes: string[] }> = []
    setMicrosoftOAuthClient(
      stubOAuth({
        exchangeCode: async (input) => {
          exchanges.push({ codeVerifier: input.codeVerifier, tenantId: input.tenantId, scopes: input.scopes })
          return {
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            scope: 'Mail.ReadWrite Mail.Send User.Read openid profile email offline_access',
            id_token: fakeJwt({ preferred_username: 'alice.upn@contoso.com', name: 'Alice', tid: 'home-tenant-guid' }),
          }
        },
        fetchProfile: async () => ({ mail: 'Alice@Contoso.com', userPrincipalName: 'alice.upn@contoso.com', displayName: 'Alice Example' }),
      }),
    )
    const result = await getMs365ChannelAdapter().exchangeOAuthCode!({
      code: 'code',
      redirectUri: 'https://x/cb',
      credentials: clientCredentials,
      scope,
      stateExtra: { codeVerifier: 'verifier-123', scopes: ['offline_access', 'openid'], tenantId: 'organizations' },
    })
    expect(exchanges[0]).toEqual({ codeVerifier: 'verifier-123', tenantId: 'organizations', scopes: ['offline_access', 'openid'] })
    expect(result.externalIdentifier).toBe('alice@contoso.com')
    expect(result.displayName).toBe('Alice Example')
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(result.credentials).toMatchObject({
      accessToken: 'at',
      refreshToken: 'rt',
      email: 'alice@contoso.com',
      displayName: 'Alice Example',
      tenantId: 'home-tenant-guid',
    })
    expect(result.credentials.scopes).toContain('Mail.Send')
  })

  it('exchangeOAuthCode falls back to id_token claims when the profile lookup fails', async () => {
    setMicrosoftOAuthClient(
      stubOAuth({
        exchangeCode: async () => ({
          access_token: 'at',
          refresh_token: 'rt',
          id_token: fakeJwt({ preferred_username: 'Alice@Contoso.com', name: 'Alice', tid: 'tid-1' }),
        }),
        fetchProfile: async () => {
          throw new Error('Graph down')
        },
      }),
    )
    const result = await getMs365ChannelAdapter().exchangeOAuthCode!({
      code: 'code',
      redirectUri: 'https://x/cb',
      credentials: clientCredentials,
      scope,
      stateExtra: { codeVerifier: 'v' },
    })
    expect(result.externalIdentifier).toBe('alice@contoso.com')
    expect(result.credentials.tenantId).toBe('tid-1')
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('exchangeOAuthCode refuses to run without the PKCE verifier from initiate', async () => {
    setMicrosoftOAuthClient(stubOAuth({}))
    await expect(
      getMs365ChannelAdapter().exchangeOAuthCode!({ code: 'code', redirectUri: 'https://x/cb', credentials: clientCredentials, scope, stateExtra: {} }),
    ).rejects.toThrow(/PKCE verifier/)
  })
})

describe('Ms365ChannelAdapter.refreshCredentials', () => {
  it('refreshes at the home tenant with the hub-resolved client config and persists the rotated refresh token', async () => {
    const calls: Array<{ tenantId: string; refreshToken: string; clientId: string }> = []
    setMicrosoftOAuthClient(
      stubOAuth({
        refreshToken: async (input) => {
          calls.push({ tenantId: input.tenantId, refreshToken: input.refreshToken, clientId: input.clientId })
          return { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600, scope: 'Mail.ReadWrite' }
        },
      }),
    )
    const result = await getMs365ChannelAdapter().refreshCredentials!({
      channelId: 'c1',
      credentials: userCredentials,
      scope,
      oauthClient: { clientId: 'hub-cid', clientSecret: 'hub-secret' },
    })
    expect(calls[0]).toEqual({ tenantId: 'home-tenant-guid', refreshToken: 'refresh', clientId: 'hub-cid' })
    expect(result.credentials).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2', email: 'alice@contoso.com' })
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('keeps the previous refresh token when the response omits one', async () => {
    setMicrosoftOAuthClient(stubOAuth({ refreshToken: async () => ({ access_token: 'at2', expires_in: 60 }) }))
    const result = await getMs365ChannelAdapter().refreshCredentials!({
      channelId: 'c1',
      credentials: userCredentials,
      scope,
      oauthClient: { clientId: 'cid', clientSecret: 'sec' },
    })
    expect(result.credentials.refreshToken).toBe('refresh')
  })

  it('surfaces requires_reauth when no refresh token is stored or the grant was revoked', async () => {
    setMicrosoftOAuthClient(stubOAuth({}))
    await expect(
      getMs365ChannelAdapter().refreshCredentials!({
        channelId: 'c1',
        credentials: { accessToken: 'a' },
        scope,
        oauthClient: { clientId: 'cid', clientSecret: 'sec' },
      }),
    ).rejects.toThrow('requires_reauth')

    setMicrosoftOAuthClient(
      stubOAuth({
        refreshToken: async () => {
          throw new Error('Microsoft 365 OAuth refresh failed: AADSTS70000: invalid_grant')
        },
      }),
    )
    await expect(
      getMs365ChannelAdapter().refreshCredentials!({
        channelId: 'c1',
        credentials: userCredentials,
        scope,
        oauthClient: { clientId: 'cid', clientSecret: 'sec' },
      }),
    ).rejects.toThrow('requires_reauth')
  })

  it('requires a client secret from the hub config', async () => {
    setMicrosoftOAuthClient(stubOAuth({}))
    await expect(
      getMs365ChannelAdapter().refreshCredentials!({ channelId: 'c1', credentials: userCredentials, scope, oauthClient: { clientId: 'cid' } }),
    ).rejects.toThrow(/client secret required/)
  })
})

describe('Ms365ChannelAdapter.fetchHistory', () => {
  function fetchHistory(channelState: Record<string, unknown> | undefined, limit?: number) {
    return getMs365ChannelAdapter().fetchHistory!({
      conversationId: 'inbox',
      credentials: userCredentials,
      scope,
      channelState,
      limit,
    })
  }

  it('bootstrap: starts the delta from a 2-minute overlap floor and ingests only mail inside that window', async () => {
    const started: Array<{ receivedSince?: Date; pageSize?: number }> = []
    const mimeFetches: string[] = []
    const recent = new Date(Date.now() - 30_000).toISOString()
    setGraphMailClient({
      ...emptyGraph(),
      startInboxDelta: async (_auth, input) => {
        started.push(input)
        return {
          value: [
            { id: 'stale-1', receivedDateTime: '2026-01-01T00:00:00Z' },
            { id: 'recent-1', receivedDateTime: recent },
          ],
          deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=seed',
        }
      },
      getMessageMime: async (_auth, id) => {
        mimeFetches.push(id)
        return buildRawMime(`${id}@example.com`)
      },
    })
    const before = Date.now()
    const page = await fetchHistory({}, 25)
    expect(started[0].pageSize).toBe(25)
    const since = started[0].receivedSince!.getTime()
    expect(before - since).toBeGreaterThanOrEqual(2 * 60_000 - 1000)
    expect(before - since).toBeLessThan(2 * 60_000 + 5000)
    expect(mimeFetches).toEqual(['recent-1'])
    expect(page.messages.map((m) => m.externalMessageId)).toEqual(['recent-1@example.com'])
    expect(page.hasMore).toBe(false)
    const state = decodeCursor(page.nextCursor)
    expect(state.deltaLink).toContain('$deltatoken=seed')
    expect(state.nextLink).toBeUndefined()
    expect(new Date(String(state.receivedWatermark)).getTime()).toBe(new Date(recent).getTime())
  })

  it('bootstrap: a multi-page initial drain resumes through nextLink on the following tick', async () => {
    setGraphMailClient({
      ...emptyGraph(),
      startInboxDelta: async () => ({ value: [], nextLink: 'https://graph.microsoft.com/v1.0/next?boot=2' }),
    })
    const first = await fetchHistory({})
    expect(first.hasMore).toBe(true)
    const state = decodeCursor(first.nextCursor)
    expect(state.nextLink).toContain('boot=2')
    expect(state.deltaLink).toBeUndefined()
    expect(typeof state.receivedWatermark).toBe('string')
  })

  it('incremental: ingests only new non-draft items at or after the watermark and advances the cursor', async () => {
    const mimeFetches: string[] = []
    setGraphMailClient({
      ...emptyGraph(),
      continueDelta: async () =>
        ({
          value: [
            { id: 'new-1', receivedDateTime: '2026-09-04T10:05:00Z', internetMessageId: '<new-1@example.com>', conversationId: 'conv-a' },
            { id: 'old-flag-change', receivedDateTime: '2026-09-04T09:00:00Z' },
            { id: 'draft-1', receivedDateTime: '2026-09-04T10:06:00Z', isDraft: true },
            { id: 'gone-1', '@removed': { reason: 'deleted' } },
            { id: 'boundary', receivedDateTime: '2026-09-04T10:00:00Z' },
          ],
          deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=advanced',
        }) satisfies GraphDeltaPage,
      getMessageMime: async (_auth, id) => {
        mimeFetches.push(id)
        return buildRawMime(`${id}@example.com`)
      },
    })
    const page = await fetchHistory({
      deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=current',
      receivedWatermark: '2026-09-04T10:00:00.000Z',
    })
    expect(mimeFetches).toEqual(['new-1', 'boundary'])
    expect(page.messages.map((m) => m.externalMessageId)).toEqual(['new-1@example.com', 'boundary@example.com'])
    expect(page.messages[0].channelMetadata).toMatchObject({ graphMessageId: 'new-1', graphConversationId: 'conv-a' })
    expect(page.hasMore).toBe(false)
    const state = decodeCursor(page.nextCursor)
    expect(state.deltaLink).toContain('$deltatoken=advanced')
    expect(state.nextLink).toBeUndefined()
    expect(state.receivedWatermark).toBe('2026-09-04T10:05:00.000Z')
  })

  it('mid-drain: keeps the terminal delta link, stores the next link and a pending watermark', async () => {
    const followed: string[] = []
    setGraphMailClient({
      ...emptyGraph(),
      continueDelta: async (_auth, link) => {
        followed.push(link)
        return {
          value: [{ id: 'p1', receivedDateTime: '2026-09-04T10:10:00Z' }],
          nextLink: 'https://graph.microsoft.com/v1.0/next?page=2',
        }
      },
    })
    const page = await fetchHistory({
      deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=current',
      receivedWatermark: '2026-09-04T10:00:00.000Z',
    })
    expect(followed).toEqual(['https://graph.microsoft.com/v1.0/delta?$deltatoken=current'])
    expect(page.hasMore).toBe(true)
    const state = decodeCursor(page.nextCursor)
    expect(state.deltaLink).toContain('$deltatoken=current')
    expect(state.nextLink).toContain('page=2')
    expect(state.receivedWatermark).toBe('2026-09-04T10:00:00.000Z')
    expect(state.pendingWatermark).toBe('2026-09-04T10:10:00.000Z')

    const secondFollowed: string[] = []
    setGraphMailClient({
      ...emptyGraph(),
      continueDelta: async (_auth, link) => {
        secondFollowed.push(link)
        return { value: [], deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=done' }
      },
    })
    const finalPage = await fetchHistory(state)
    expect(secondFollowed).toEqual(['https://graph.microsoft.com/v1.0/next?page=2'])
    const finalState = decodeCursor(finalPage.nextCursor)
    expect(finalState.deltaLink).toContain('$deltatoken=done')
    expect(finalState.receivedWatermark).toBe('2026-09-04T10:10:00.000Z')
    expect(finalState.pendingWatermark).toBeUndefined()
    expect(finalState.nextLink).toBeUndefined()
  })

  it('re-bootstraps from the watermark and ingests when the delta token expired (410)', async () => {
    const started: Array<{ receivedSince?: Date }> = []
    setGraphMailClient({
      ...emptyGraph(),
      continueDelta: async () => {
        throw new GraphApiError('gone', 410, 'gone', { code: 'syncStateNotFound' })
      },
      startInboxDelta: async (_auth, input) => {
        started.push(input)
        return { value: [{ id: 'missed-1', receivedDateTime: '2026-09-04T10:30:00Z' }], deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=fresh' }
      },
    })
    const page = await fetchHistory({
      deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=expired',
      receivedWatermark: '2026-09-04T10:00:00.000Z',
    })
    expect(started[0].receivedSince?.toISOString()).toBe('2026-09-04T10:00:00.000Z')
    expect(page.messages.map((m) => m.externalMessageId)).toEqual(['missed-1@example.com'])
    const state = decodeCursor(page.nextCursor)
    expect(state.deltaLink).toContain('$deltatoken=fresh')
    expect(state.receivedWatermark).toBe('2026-09-04T10:30:00.000Z')
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('skips messages that vanished (404) and pins the cursor on a transient fetch failure', async () => {
    setGraphMailClient({
      ...emptyGraph(),
      continueDelta: async () => ({
        value: [
          { id: 'ok-1', receivedDateTime: '2026-09-04T10:05:00Z' },
          { id: 'vanished', receivedDateTime: '2026-09-04T10:06:00Z' },
          { id: 'flaky', receivedDateTime: '2026-09-04T10:07:00Z' },
          { id: 'never-reached', receivedDateTime: '2026-09-04T10:08:00Z' },
        ],
        deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=advanced',
      }),
      getMessageMime: async (_auth, id) => {
        if (id === 'vanished') throw new GraphApiError('nf', 404, 'not found')
        if (id === 'flaky') throw new GraphApiError('boom', 503, 'unavailable')
        return buildRawMime(`${id}@example.com`)
      },
    })
    const incoming = {
      deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=current',
      receivedWatermark: '2026-09-04T10:00:00.000Z',
    }
    const page = await fetchHistory(incoming)
    expect(page.messages.map((m) => m.externalMessageId)).toEqual(['ok-1@example.com'])
    expect(page.hasMore).toBe(true)
    const state = decodeCursor(page.nextCursor)
    expect(state.deltaLink).toContain('$deltatoken=current')
    expect(state.receivedWatermark).toBe('2026-09-04T10:00:00.000Z')
  })

  it('surfaces requires_reauth on a 401 from Graph', async () => {
    setGraphMailClient({
      ...emptyGraph(),
      continueDelta: async () => {
        throw new GraphApiError('unauthorized', 401, 'InvalidAuthenticationToken')
      },
    })
    await expect(fetchHistory({ deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=x' })).rejects.toThrow('requires_reauth')
  })

  it('translates a permanent mailbox-access 403 into an actionable non-transient error', async () => {
    setGraphMailClient({
      ...emptyGraph(),
      continueDelta: async () => {
        throw new GraphApiError('denied', 403, 'Access is denied', { code: 'MailboxNotEnabledForRESTAPI' })
      },
    })
    await expect(fetchHistory({ deltaLink: 'https://graph.microsoft.com/v1.0/delta?$deltatoken=x' })).rejects.toMatchObject({
      status: 403,
      transient: false,
      message: expect.stringContaining('licensed for Exchange Online'),
    })
  })
})

describe('Ms365ChannelAdapter.importHistory', () => {
  it('builds the Graph filter with the date floor first and OR-ed senders', () => {
    const filter = buildImportFilter(new Date('2026-08-01T00:00:00.000Z'), ["bob@example.com", "o'brien@example.com"])
    expect(filter).toBe(
      "receivedDateTime ge 2026-08-01T00:00:00.000Z and (from/emailAddress/address eq 'bob@example.com' or from/emailAddress/address eq 'o''brien@example.com')",
    )
    expect(buildImportFilter(new Date('2026-08-01T00:00:00.000Z'), undefined)).toBe('receivedDateTime ge 2026-08-01T00:00:00.000Z')
  })

  it('pages through the inbox list via the next link cursor and reports the candidate count', async () => {
    const lists: Array<{ filter: string; includeCount?: boolean }> = []
    const continued: string[] = []
    setGraphMailClient({
      ...emptyGraph(),
      listInboxMessages: async (_auth, input) => {
        lists.push({ filter: input.filter, includeCount: input.includeCount })
        return { value: [{ id: 'h1' }, { id: 'draft', isDraft: true }], nextLink: 'https://graph.microsoft.com/v1.0/next?p=2', count: 3 } satisfies GraphListPage
      },
      continueList: async (_auth, link) => {
        continued.push(link)
        return { value: [{ id: 'h2' }] }
      },
    })
    const adapter = getMs365ChannelAdapter()
    const first = await adapter.importHistory!({ credentials: userCredentials, scope, sinceDays: 30, contactEmails: ['bob@example.com'] })
    expect(lists[0].filter).toContain("from/emailAddress/address eq 'bob@example.com'")
    expect(lists[0].includeCount).toBe(true)
    expect(first.messages.map((m) => m.externalMessageId)).toEqual(['h1@example.com'])
    expect(first.hasMore).toBe(true)
    expect(first.totalCandidates).toBe(3)

    const second = await adapter.importHistory!({ credentials: userCredentials, scope, sinceDays: 30, contactEmails: ['bob@example.com'], cursor: first.nextCursor })
    expect(continued).toEqual(['https://graph.microsoft.com/v1.0/next?p=2'])
    expect(second.messages.map((m) => m.externalMessageId)).toEqual(['h2@example.com'])
    expect(second.hasMore).toBe(false)
  })

  it('splits long sender lists into chunks and walks them across pages', async () => {
    const filters: string[] = []
    setGraphMailClient({
      ...emptyGraph(),
      listInboxMessages: async (_auth, input) => {
        filters.push(input.filter)
        return { value: [{ id: `chunk-${filters.length}` }] }
      },
    })
    const contactEmails = Array.from({ length: 17 }, (_, index) => `person${index}@example.com`)
    const adapter = getMs365ChannelAdapter()
    const first = await adapter.importHistory!({ credentials: userCredentials, scope, sinceDays: 7, contactEmails })
    expect(first.hasMore).toBe(true)
    const second = await adapter.importHistory!({ credentials: userCredentials, scope, sinceDays: 7, contactEmails, cursor: first.nextCursor })
    expect(second.hasMore).toBe(false)
    expect(filters).toHaveLength(2)
    expect(filters[0]).toContain('person0@example.com')
    expect(filters[0]).not.toContain('person16@example.com')
    expect(filters[1]).toContain('person16@example.com')
  })

  it('respects maxMessages across pages', async () => {
    setGraphMailClient({
      ...emptyGraph(),
      listInboxMessages: async () => ({ value: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], nextLink: 'https://graph.microsoft.com/v1.0/next?p=2' }),
    })
    const page = await getMs365ChannelAdapter().importHistory!({ credentials: userCredentials, scope, sinceDays: 7, maxMessages: 2 })
    expect(page.messages).toHaveLength(2)
    expect(page.hasMore).toBe(false)
  })
})

describe('Ms365ChannelAdapter.sendMessage', () => {
  function send(overrides: Partial<GraphMailClient>) {
    setGraphMailClient({ ...emptyGraph(), ...overrides })
    return getMs365ChannelAdapter().sendMessage({
      conversationId: 'thread-1',
      content: { html: '<p>Hi</p>', bodyFormat: 'html' },
      credentials: userCredentials,
      scope,
      metadata: { to: ['bob@example.com'], subject: 'Hello', inReplyTo: 'orig@example.com' },
    })
  }

  it('creates a draft from MIME, sends it, and reports the authoritative internetMessageId', async () => {
    const drafts: Buffer[] = []
    const sent: string[] = []
    const result = await send({
      createDraftFromMime: async (_auth, mime) => {
        drafts.push(mime)
        return { id: 'draft-9', internetMessageId: '<exchange-assigned@contoso.com>', conversationId: 'conv-9' }
      },
      sendDraft: async (_auth, id) => {
        sent.push(id)
      },
    })
    const mime = drafts[0].toString('utf-8')
    expect(mime).toContain('From: "Alice Example" <alice@contoso.com>')
    expect(mime).toContain('To: bob@example.com')
    expect(mime).toContain('Subject: Hello')
    expect(mime).toContain('In-Reply-To: <orig@example.com>')
    expect(sent).toEqual(['draft-9'])
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBe('exchange-assigned@contoso.com')
    expect(result.conversationId).toBe('thread-1')
    expect(result.metadata).toMatchObject({ graphMessageId: 'draft-9', graphConversationId: 'conv-9' })
  })

  it('returns the requires_reauth sentinel on a 401 without deleting the draft', async () => {
    const deleted: string[] = []
    const result = await send({
      sendDraft: async () => {
        throw new GraphApiError('unauthorized', 401, 'InvalidAuthenticationToken')
      },
      deleteMessage: async (_auth, id) => {
        deleted.push(id)
      },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('requires_reauth')
    expect(deleted).toHaveLength(0)
  })

  it('reports sent when the /send response was lost but Graph shows the draft as sent', async () => {
    const deleted: string[] = []
    const result = await send({
      sendDraft: async () => {
        throw new GraphApiError('timed out', 599, 'request timed out')
      },
      getMessageState: async (_auth, id) => ({ id, isDraft: false, sentDateTime: '2026-09-04T20:00:00Z' }),
      deleteMessage: async (_auth, id) => {
        deleted.push(id)
      },
    })
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBe('sent-1@contoso.com')
    expect(deleted).toHaveLength(0)
    expect(loggerWarn).toHaveBeenCalled()
  })

  it('reports a transient send failure without deleting the still-unsent draft', async () => {
    const deleted: string[] = []
    const result = await send({
      sendDraft: async () => {
        throw new GraphApiError('throttled', 429, 'TooManyRequests')
      },
      getMessageState: async (_auth, id) => ({ id, isDraft: true }),
      deleteMessage: async (_auth, id) => {
        deleted.push(id)
      },
    })
    expect(result.status).toBe('failed')
    expect(deleted).toHaveLength(0)
  })

  it('cleans up the orphan draft after a permanent send failure', async () => {
    const deleted: string[] = []
    const result = await send({
      sendDraft: async () => {
        throw new GraphApiError('denied', 403, 'ErrorSendAsDenied', { code: 'ErrorSendAsDenied' })
      },
      deleteMessage: async (_auth, id) => {
        deleted.push(id)
      },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('ErrorSendAsDenied')
    expect(deleted).toEqual(['draft-1'])
  })

  it('fails legibly when the channel has no mailbox address', async () => {
    setGraphMailClient(emptyGraph())
    const result = await getMs365ChannelAdapter().sendMessage({
      content: { text: 'x' },
      credentials: { accessToken: 'a' },
      scope,
      metadata: { to: ['bob@example.com'] },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('no mailbox address')
  })
})

describe('Ms365ChannelAdapter.deleteMessage', () => {
  it('looks the Graph id up by bracketed internetMessageId and moves it to Deleted Items', async () => {
    const lookups: string[] = []
    const moves: Array<{ id: string; destination: string }> = []
    setGraphMailClient({
      ...emptyGraph(),
      findMessageIdByInternetMessageId: async (_auth, internetMessageId) => {
        lookups.push(internetMessageId)
        return 'graph-42'
      },
      moveMessage: async (_auth, id, destination) => {
        moves.push({ id, destination })
      },
    })
    await getMs365ChannelAdapter().deleteMessage!({ externalMessageId: 'msg-42@example.com', conversationId: 'c', credentials: userCredentials, scope })
    expect(lookups).toEqual(['<msg-42@example.com>'])
    expect(moves).toEqual([{ id: 'graph-42', destination: 'deleteditems' }])
  })

  it('is a no-op when the message is already gone', async () => {
    const moves: string[] = []
    setGraphMailClient({
      ...emptyGraph(),
      findMessageIdByInternetMessageId: async () => null,
      moveMessage: async (_auth, id) => {
        moves.push(id)
      },
    })
    await getMs365ChannelAdapter().deleteMessage!({ externalMessageId: 'x', conversationId: 'c', credentials: userCredentials, scope })
    expect(moves).toHaveLength(0)
  })
})

describe('Ms365ChannelAdapter.resolveContact + normalizeInbound', () => {
  it('passes email senders through as contact hints', async () => {
    const hint = await getMs365ChannelAdapter().resolveContact!({ senderIdentifier: 'bob@example.com', senderDisplayName: 'Bob', credentials: userCredentials, scope })
    expect(hint).toEqual({ email: 'bob@example.com', displayName: 'Bob' })
  })

  it('normalizes a raw MIME payload handed back by the hub', async () => {
    const normalized = await getMs365ChannelAdapter().normalizeInbound({
      raw: { rawBase64: buildRawMime('abc@example.com').toString('base64'), graphMessageId: 'g1', accountIdentifier: 'alice@contoso.com' },
    })
    expect(normalized.externalMessageId).toBe('abc@example.com')
    expect(normalized.channelMetadata).toMatchObject({ graphMessageId: 'g1' })
  })
})
