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
  it('accepts a good token (users/@me succeeds)', async () => {
    stubRest()
    const adapter = getDiscordChannelAdapter()
    const result = await adapter.validateCredentials({ providerKey: 'discord', credentials, scope: { organizationId: 'o', tenantId: 't' } })
    expect(result.ok).toBe(true)
  })

  it('rejects a bad token with a field error', async () => {
    stubRest({
      async getCurrentUser() {
        const { DiscordApiError } = await import('../discord-rest')
        throw new DiscordApiError('unauthorized', 401, 'unauthorized')
      },
    })
    const adapter = getDiscordChannelAdapter()
    const result = await adapter.validateCredentials({ providerKey: 'discord', credentials, scope: { organizationId: 'o', tenantId: 't' } })
    expect(result.ok).toBe(false)
    expect(result.errors?.botToken).toBeTruthy()
  })
})
