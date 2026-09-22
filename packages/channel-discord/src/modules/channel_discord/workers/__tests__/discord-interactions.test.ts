import { COMMUNICATION_CHANNELS_QUEUES } from '@open-mercato/core/modules/communication_channels/lib/queue'
import { setDiscordRestClient, type DiscordRestClient } from '../../lib/discord-rest'
import type { DispatchableInteraction } from '../../lib/interactions-dispatch'
import type { InteractionDispatchJobPayload } from '../../lib/interactions-queue'
import { DiscordInteractionType } from '../../lib/interactions-verify'
import handle from '../discord-interactions'

const enqueue = jest.fn(async () => {})

jest.mock('@open-mercato/core/modules/communication_channels/lib/queue', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/communication_channels/lib/queue')
  return { ...actual, getCommunicationChannelsQueue: () => ({ enqueue }) }
})

const interaction: DispatchableInteraction = {
  id: 'interaction-1',
  token: 'interaction-token',
  type: DiscordInteractionType.APPLICATION_COMMAND,
  applicationId: 'app-1',
  discordChannelId: 'discord-channel-1',
  guildId: 'guild-1',
  user: { id: 'user-1', username: 'ada' },
  commandName: 'mercato',
  content: '/mercato message:the printer is jammed',
  timestamp: '2026-06-19T10:00:00.000Z',
}

function payload(overrides: Partial<InteractionDispatchJobPayload> = {}): InteractionDispatchJobPayload {
  return {
    channelId: 'ch-1',
    channelType: 'discord',
    tenantId: 't-1',
    organizationId: 'o-1',
    credentialScope: { tenantId: 't-1', organizationId: 'o-1', userId: null },
    interaction,
    ...overrides,
  }
}

const credentials = {
  botToken: 'bot-token',
  applicationId: 'app-1',
  publicKey: 'ab'.repeat(32),
}

function context(resolved: Record<string, unknown> | null = credentials) {
  const resolve = jest.fn(async () => resolved)
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'integrationCredentialsService') return { resolve } as unknown as T
      throw new Error(`[internal] unexpected DI key ${name}`)
    },
    credentialsResolve: resolve,
  }
}

function restClient(overrides: Partial<DiscordRestClient> = {}) {
  const client = {
    editOriginalInteractionResponse: jest.fn(async () => {}),
    createInteractionFollowUp: jest.fn(async () => {}),
    ...overrides,
  }
  setDiscordRestClient(client as unknown as DiscordRestClient)
  return client
}

afterEach(() => {
  enqueue.mockClear()
  setDiscordRestClient(null)
})

describe('discord interactions worker', () => {
  it('normalizes the interaction into the hub inbound queue and replaces the deferred ack', async () => {
    const client = restClient()
    const ctx = context()

    await handle({ payload: payload() } as never, ctx as never)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: 'discord',
        channelId: 'ch-1',
        channelType: 'discord',
        scope: { tenantId: 't-1', organizationId: 'o-1' },
      }),
    )
    expect(COMMUNICATION_CHANNELS_QUEUES.inbound).toBe('communication-channels-inbound')

    expect(client.editOriginalInteractionResponse).toHaveBeenCalledTimes(1)
    const [applicationId, token, body] = client.editOriginalInteractionResponse.mock.calls[0] as unknown as [
      string,
      string,
      { content: string; ephemeral?: boolean },
    ]
    expect(applicationId).toBe('app-1')
    expect(token).toBe('interaction-token')
    expect(body.ephemeral).toBe(true)
    expect(body.content).toContain('/mercato')
  })

  it('re-resolves the bot token from the credential store — the payload never carries one', async () => {
    restClient()
    const ctx = context()

    await handle({ payload: payload() } as never, ctx as never)

    expect(ctx.credentialsResolve).toHaveBeenCalledWith('channel_discord', {
      tenantId: 't-1',
      organizationId: 'o-1',
      userId: null,
    })
    expect(JSON.stringify(payload())).not.toContain('bot-token')
  })

  it('still records the interaction in the hub when no credentials can answer it', async () => {
    const client = restClient()
    const ctx = context(null)

    await handle({ payload: payload() } as never, ctx as never)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(client.editOriginalInteractionResponse).not.toHaveBeenCalled()
  })

  it('propagates a follow-up failure so the queue retries inside the token lifetime', async () => {
    restClient({
      editOriginalInteractionResponse: jest.fn(async () => {
        throw new Error('discord 500')
      }),
      createInteractionFollowUp: jest.fn(async () => {
        throw new Error('discord 500')
      }),
    })

    await expect(handle({ payload: payload() } as never, context() as never)).rejects.toThrow('discord 500')
  })

  it('drops a bot-invoked interaction from the hub but still answers it', async () => {
    const client = restClient()

    await handle(
      {
        payload: payload({ interaction: { ...interaction, user: { id: 'bot-1', username: 'bot', bot: true } } }),
      } as never,
      context() as never,
    )

    expect(enqueue).not.toHaveBeenCalled()
    expect(client.editOriginalInteractionResponse).toHaveBeenCalledTimes(1)
  })
})
