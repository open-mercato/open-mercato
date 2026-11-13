import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { getDiscordChannelAdapter } from '../adapter'
import {
  setDiscordRestClient,
  type CreateMessageInput,
  type DiscordMessageObject,
  type DiscordRestClient,
  type DiscordUser,
} from '../discord-rest'
import { DISCORD_CONVERSATION_PREFIX } from '../normalize-inbound'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (key: string) => key })),
}))

function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  return {
    publicKeyHex: spki.subarray(spki.length - 32).toString('hex'),
    sign: (message: string) => cryptoSign(null, Buffer.from(message, 'utf-8'), privateKey).toString('hex'),
  }
}

function stubRest(overrides: Partial<DiscordRestClient> = {}): {
  captured: { createMessage?: CreateMessageInput }
} {
  const captured: { createMessage?: CreateMessageInput } = {}
  const base: DiscordRestClient = {
    async createMessage(_auth, input): Promise<DiscordMessageObject> {
      captured.createMessage = input
      return {
        id: 'sent-1',
        channel_id: input.channelId,
        content: input.content,
        author: { id: 'bot', username: 'bot' },
        timestamp: '2026-06-19T10:00:00.000Z',
      }
    },
    async editMessage(_a, channelId, _m, content) {
      return { id: 'm', channel_id: channelId, content, author: { id: 'b', username: 'b' }, timestamp: '' }
    },
    async deleteMessage() {},
    async addReaction() {},
    async removeReaction() {},
    async listMessages() {
      return []
    },
    async getCurrentUser(): Promise<DiscordUser> {
      return { id: 'bot-user', username: 'bot' }
    },
    async getCurrentApplication() {
      return { id: credentials.applicationId, verify_key: credentials.publicKey }
    },
    async getGatewayBot() {
      return { url: 'wss://gateway', shards: 1 }
    },
    async registerGuildCommands() {},
    ...overrides,
  }
  setDiscordRestClient(base)
  return { captured }
}

const credentials = {
  botToken: 'bot-token-abc',
  applicationId: '123',
  publicKey: 'a'.repeat(64),
}

afterEach(() => setDiscordRestClient(null))

describe('DiscordChannelAdapter.sendMessage', () => {
  it('builds a REST createMessage request against the resolved channel id', async () => {
    const { captured } = stubRest()
    const adapter = getDiscordChannelAdapter()
    const result = await adapter.sendMessage({
      conversationId: `${DISCORD_CONVERSATION_PREFIX}chan-77`,
      content: { text: 'hi there', bodyFormat: 'markdown' },
      credentials,
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(captured.createMessage?.channelId).toBe('chan-77')
    expect(captured.createMessage?.content).toBe('hi there')
    expect(result.status).toBe('sent')
    expect(result.externalMessageId).toBe('sent-1')
    expect(result.conversationId).toBe(`${DISCORD_CONVERSATION_PREFIX}chan-77`)
  })

  it('falls back to defaultChannelId when no conversation id is given', async () => {
    const { captured } = stubRest()
    const adapter = getDiscordChannelAdapter()
    await adapter.sendMessage({
      content: { text: 'x' },
      credentials: { ...credentials, defaultChannelId: 'default-chan' },
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(captured.createMessage?.channelId).toBe('default-chan')
  })

  it('explains itself to the operator when nothing names a channel', async () => {
    // Reachable from the product since #4976 made test-send's recipient
    // optional: an operator smoke-tests a connection whose `Default channel ID`
    // was left blank. The route hands `result.error` straight back as
    // `providerError`, so this string is read by a person, not a log.
    const { captured } = stubRest()
    const adapter = getDiscordChannelAdapter()

    const result = await adapter.sendMessage({
      content: { text: 'x' },
      credentials,
      scope: { organizationId: 'o', tenantId: 't' },
    })

    expect(result.status).toBe('failed')
    expect(result.error).toBe(
      'No Discord channel to post to — set "Default channel ID" on the connection, or pass a channel id as the recipient.',
    )
    expect(result.error).not.toContain('[internal]')
    // Nothing is posted when there is no target.
    expect(captured.createMessage).toBeUndefined()
  })

  it('posts to the recipient the hub resolved, instead of silently using the default', async () => {
    // QA of #4391 against a live bot: the hub's test-send route puts the
    // operator's recipient in `metadata.to`, nothing read it, and every send
    // went to `defaultChannelId` while the endpoint answered `200 sent`. A
    // recipient that is validated and then discarded is worse than one that is
    // rejected — the operator gets a success for a message that went elsewhere.
    const { captured } = stubRest()
    const adapter = getDiscordChannelAdapter()
    await adapter.sendMessage({
      content: { text: 'x' },
      credentials: { ...credentials, defaultChannelId: 'default-chan' },
      metadata: { to: 'requested-chan', testSend: true },
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(captured.createMessage?.channelId).toBe('requested-chan')
  })

  it('never lets a stray recipient redirect a reply out of its own conversation', async () => {
    // `conversationId` outranks `metadata.to` on purpose: on a reply the thread
    // mapping is authoritative.
    const { captured } = stubRest()
    const adapter = getDiscordChannelAdapter()
    await adapter.sendMessage({
      conversationId: `${DISCORD_CONVERSATION_PREFIX}thread-chan`,
      content: { text: 'x' },
      credentials: { ...credentials, defaultChannelId: 'default-chan' },
      metadata: { to: 'somewhere-else' },
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(captured.createMessage?.channelId).toBe('thread-chan')
  })

  it('clamps content to Discord 2000-char limit', async () => {
    const { captured } = stubRest()
    const adapter = getDiscordChannelAdapter()
    await adapter.sendMessage({
      conversationId: 'chan',
      content: { text: 'a'.repeat(5000), bodyFormat: 'markdown' },
      credentials,
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(captured.createMessage?.content.length).toBe(2000)
  })
})

describe('DiscordChannelAdapter.verifyWebhook (fail-closed)', () => {
  const signer = makeSigner()
  const creds = { ...credentials, publicKey: signer.publicKeyHex }
  const timestamp = '1700000000'
  const rawBody = JSON.stringify({ type: 1 })

  it('returns eventType other for a validly signed interaction', async () => {
    const adapter = getDiscordChannelAdapter()
    const result = await adapter.verifyWebhook({
      rawBody,
      headers: {
        'x-signature-ed25519': signer.sign(timestamp + rawBody),
        'x-signature-timestamp': timestamp,
      },
      credentials: creds,
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(result.eventType).toBe('other')
  })

  it('throws on a tampered interaction signature', async () => {
    const adapter = getDiscordChannelAdapter()
    await expect(
      adapter.verifyWebhook({
        rawBody,
        headers: {
          'x-signature-ed25519': signer.sign(timestamp + '{"type":2}'),
          'x-signature-timestamp': timestamp,
        },
        credentials: creds,
        scope: { organizationId: 'o', tenantId: 't' },
      }),
    ).rejects.toThrow()
  })

  it('returns eventType other for a non-interaction body (gateway-delivered messages)', async () => {
    const adapter = getDiscordChannelAdapter()
    const result = await adapter.verifyWebhook({
      rawBody: JSON.stringify({ not: 'an interaction' }),
      headers: {},
      credentials: creds,
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(result.eventType).toBe('other')
  })
})

describe('DiscordChannelAdapter.validateCredentials', () => {
  it('accepts a token belonging to the supplied application and verification key', async () => {
    stubRest()
    const adapter = getDiscordChannelAdapter()
    const result = await adapter.validateCredentials({ providerKey: 'discord', credentials, scope: { organizationId: 'o', tenantId: 't' } })
    expect(result.ok).toBe(true)
  })

  it('reports the application id as the stable channel identity so a reconnect heals in place', async () => {
    stubRest()
    const adapter = getDiscordChannelAdapter()
    const first = await adapter.validateCredentials({ providerKey: 'discord', credentials, scope: { organizationId: 'o', tenantId: 't' } })
    const rotated = await adapter.validateCredentials({
      providerKey: 'discord',
      credentials: { ...credentials, botToken: 'bot-token-rotated', guildId: '999' },
      scope: { organizationId: 'o', tenantId: 't' },
    })
    expect(first.externalIdentifier).toBe('discord:123')
    expect(rotated.externalIdentifier).toBe(first.externalIdentifier)
  })

  it('rejects a bad token with a field error', async () => {
    stubRest({
      async getCurrentApplication() {
        const { DiscordApiError } = await import('../discord-rest')
        throw new DiscordApiError('unauthorized', 401, 'unauthorized')
      },
    })
    const adapter = getDiscordChannelAdapter()
    const result = await adapter.validateCredentials({ providerKey: 'discord', credentials, scope: { organizationId: 'o', tenantId: 't' } })
    expect(result.ok).toBe(false)
    expect(result.errors?.botToken).toBeTruthy()
    expect(result.externalIdentifier).toBeUndefined()
  })

  it.each([
    ['applicationId', { applicationId: 'another-application' }],
    ['publicKey', { publicKey: 'b'.repeat(64) }],
  ])('rejects a mismatched %s even when the bot token authenticates', async (field, mismatch) => {
    stubRest()
    const result = await getDiscordChannelAdapter().validateCredentials({
      providerKey: 'discord', credentials: { ...credentials, ...mismatch },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors?.[field]).toBeTruthy()
    expect(result.externalIdentifier).toBeUndefined()
  })

  it('accepts equivalent uppercase hex verification keys', async () => {
    stubRest()
    const result = await getDiscordChannelAdapter().validateCredentials({
      providerKey: 'discord', credentials: { ...credentials, publicKey: credentials.publicKey.toUpperCase() },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result.ok).toBe(true)
    expect(result.externalIdentifier).toBe('discord:123')
  })

  it('fails closed for a legacy REST override without authenticated application metadata', async () => {
    stubRest({ getCurrentApplication: undefined })
    const result = await getDiscordChannelAdapter().validateCredentials({
      providerKey: 'discord', credentials, scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors?.botToken).toBeTruthy()
    expect(result.externalIdentifier).toBeUndefined()
  })

  it('fails closed when the authenticated application lookup is unavailable', async () => {
    stubRest({ async getCurrentApplication() { throw new Error('[internal] unavailable') } })
    const result = await getDiscordChannelAdapter().validateCredentials({
      providerKey: 'discord', credentials, scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors?.botToken).toBeTruthy()
    expect(result.externalIdentifier).toBeUndefined()
  })
})

describe('Discord credential validation through the REST transport', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each([
    [{ id: credentials.applicationId, verify_key: credentials.publicKey }, true],
    [{ id: 'another-application', verify_key: credentials.publicKey }, false],
    [{ id: credentials.applicationId, verify_key: 'b'.repeat(64) }, false],
    [{ id: credentials.applicationId }, false],
    [{ id: credentials.applicationId, verify_key: 123 }, false],
    [{ id: credentials.applicationId, verify_key: 'not-hex' }, false],
    [null, false],
  ])('validates authenticated application metadata %j', async (application, accepted) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(application)))
    const result = await getDiscordChannelAdapter().validateCredentials({
      providerKey: 'discord', credentials, scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(fetchSpy).toHaveBeenCalledWith('https://discord.com/api/v10/oauth2/applications/@me', expect.objectContaining({
      method: 'GET', headers: { Authorization: `Bot ${credentials.botToken}` }, signal: expect.any(AbortSignal),
    }))
    expect(result.ok).toBe(accepted)
    expect(result.externalIdentifier).toBe(accepted ? 'discord:123' : undefined)
  })
})
