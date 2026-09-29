import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { DiscordRestClient } from '../discord-rest'
import {
  buildInteractionFollowUpContent,
  buildInteractionInboundJob,
  buildInteractionMessage,
  readDispatchableInteraction,
  renderInteractionContent,
  sendInteractionFollowUp,
  type DispatchableInteraction,
} from '../interactions-dispatch'
import { DiscordInteractionType, type ParsedInteraction } from '../interactions-verify'
import { normalizeInboundDiscordMessage } from '../normalize-inbound'

const now = new Date('2026-06-19T10:00:00.000Z')

function slashCommand(overrides: Partial<ParsedInteraction> = {}): ParsedInteraction {
  return {
    type: DiscordInteractionType.APPLICATION_COMMAND,
    id: 'interaction-1',
    token: 'interaction-token',
    application_id: 'app-1',
    channel_id: 'discord-channel-1',
    guild_id: 'guild-1',
    member: { user: { id: 'user-1', username: 'ada', global_name: 'Ada L.' } },
    data: { name: 'mercato', options: [{ name: 'message', value: 'the printer is jammed' }] },
    ...overrides,
  }
}

describe('renderInteractionContent', () => {
  it('renders a slash command with its options', () => {
    expect(renderInteractionContent(slashCommand())).toBe('/mercato message:the printer is jammed')
  })

  it('descends into subcommands instead of losing what the user typed', () => {
    // Discord nests the real arguments under the subcommand's own `options`, so
    // a one-level read renders `/support ticket:` and drops the payload.
    const content = renderInteractionContent(
      slashCommand({
        data: {
          name: 'support',
          options: [
            { name: 'ticket', options: [{ name: 'subject', value: 'jam' }, { name: 'priority', value: 2 }] },
          ],
        },
      }),
    )
    expect(content).toBe('/support ticket subject:jam priority:2')
  })

  it('renders a component press with its selected values', () => {
    const content = renderInteractionContent({
      type: DiscordInteractionType.MESSAGE_COMPONENT,
      data: { custom_id: 'escalate', values: ['tier-2', 'urgent'] },
    })
    expect(content).toBe('[component] escalate tier-2 urgent')
  })

  it('renders a modal submission field by field', () => {
    const content = renderInteractionContent({
      type: DiscordInteractionType.MODAL_SUBMIT,
      data: {
        custom_id: 'ticket-form',
        components: [{ components: [{ custom_id: 'subject', value: 'jam' }] }],
      },
    })
    expect(content).toBe('[modal] ticket-form subject:jam')
  })
})

describe('readDispatchableInteraction', () => {
  it('extracts everything the worker needs from a guild slash command', () => {
    const dispatch = readDispatchableInteraction(slashCommand(), { now })
    expect(dispatch).toEqual({
      id: 'interaction-1',
      token: 'interaction-token',
      type: DiscordInteractionType.APPLICATION_COMMAND,
      applicationId: 'app-1',
      discordChannelId: 'discord-channel-1',
      guildId: 'guild-1',
      user: { id: 'user-1', username: 'ada', global_name: 'Ada L.' },
      commandName: 'mercato',
      customId: undefined,
      content: '/mercato message:the printer is jammed',
      timestamp: now.toISOString(),
    })
  })

  it('reads the invoker from `user` in a DM, where there is no `member`', () => {
    const dispatch = readDispatchableInteraction(
      slashCommand({ member: undefined, guild_id: undefined, user: { id: 'user-2', username: 'grace' } }),
      { now },
    )
    expect(dispatch?.user.id).toBe('user-2')
    expect(dispatch?.guildId).toBeUndefined()
  })

  it.each([
    ['no follow-up token', { token: undefined }],
    ['no interaction id', { id: undefined }],
    ['no channel', { channel_id: undefined }],
    ['no application', { application_id: undefined }],
    ['no invoking user', { member: undefined, user: undefined }],
  ])('refuses to dispatch a payload with %s', (_label, overrides) => {
    expect(readDispatchableInteraction(slashCommand(overrides as Partial<ParsedInteraction>), { now })).toBeNull()
  })

  it('refuses interaction types this provider does not turn into hub messages', () => {
    expect(readDispatchableInteraction(slashCommand({ type: DiscordInteractionType.PING }), { now })).toBeNull()
    expect(
      readDispatchableInteraction(
        slashCommand({ type: DiscordInteractionType.APPLICATION_COMMAND_AUTOCOMPLETE }),
        { now },
      ),
    ).toBeNull()
  })
})

describe('buildInteractionInboundJob', () => {
  const channel = { channelId: 'ch-1', channelType: 'discord', tenantId: 't-1', organizationId: 'o-1' }

  it('produces the same job shape the gateway worker enqueues, under the matched tenant scope', () => {
    const dispatch = readDispatchableInteraction(slashCommand(), { now }) as DispatchableInteraction
    const job = buildInteractionInboundJob({ dispatch, channel })

    expect(job).toMatchObject({
      providerKey: 'discord',
      channelId: 'ch-1',
      channelType: 'discord',
      scope: { tenantId: 't-1', organizationId: 'o-1' },
    })
    expect(job?.raw.eventType).toBe('message')
  })

  it('normalizes through the adapter path into a hub message keyed on the interaction id', () => {
    // The point of synthesizing a message object is that the hub's existing
    // inbound path handles it unchanged — so drive the real normalizer.
    const dispatch = readDispatchableInteraction(slashCommand(), { now }) as DispatchableInteraction
    const normalized = normalizeInboundDiscordMessage(buildInteractionMessage(dispatch))

    expect(normalized.externalMessageId).toBe('interaction-1')
    expect(normalized.externalConversationId).toBe('discord-channel:discord-channel-1')
    expect(normalized.senderIdentifier).toBe('user-1')
    expect(normalized.body).toBe('/mercato message:the printer is jammed')
    expect(normalized.channelMetadata).toMatchObject({
      discordInteractionId: 'interaction-1',
      discordInteractionType: DiscordInteractionType.APPLICATION_COMMAND,
      discordCommandName: 'mercato',
    })
  })

  it('drops an interaction invoked by a bot — the same feedback-loop guard as inbound messages', () => {
    const dispatch = readDispatchableInteraction(
      slashCommand({ member: { user: { id: 'bot-1', username: 'other-bot' } } }),
      { now },
    ) as DispatchableInteraction
    const botAuthored = { ...dispatch, user: { ...dispatch.user, bot: true } }
    expect(buildInteractionInboundJob({ dispatch: botAuthored, channel })).toBeNull()
  })
})

describe('sendInteractionFollowUp', () => {
  function restClient(overrides: Partial<DiscordRestClient>): DiscordRestClient {
    return {
      editOriginalInteractionResponse: jest.fn(async () => {}),
      createInteractionFollowUp: jest.fn(async () => {}),
      ...overrides,
    } as unknown as DiscordRestClient
  }

  const input = { applicationId: 'app-1', interactionToken: 'tok', content: 'done', ephemeral: true }

  it('edits the original response, because that is what ends the "thinking" state', async () => {
    const client = restClient({})
    await expect(sendInteractionFollowUp(client, input)).resolves.toBe('edited-original')
    expect(client.editOriginalInteractionResponse).toHaveBeenCalledWith('app-1', 'tok', {
      content: 'done',
      ephemeral: true,
    })
    expect(client.createInteractionFollowUp).not.toHaveBeenCalled()
  })

  it('falls back to a follow-up message when the original response is gone', async () => {
    const client = restClient({
      editOriginalInteractionResponse: jest.fn(async () => {
        throw new Error('404 Unknown Webhook')
      }),
    })
    await expect(sendInteractionFollowUp(client, input)).resolves.toBe('follow-up')
    expect(client.createInteractionFollowUp).toHaveBeenCalledTimes(1)
  })

  it('rethrows when neither call delivers, so the queue retries inside the token lifetime', async () => {
    const client = restClient({
      editOriginalInteractionResponse: jest.fn(async () => {
        throw new Error('edit failed')
      }),
      createInteractionFollowUp: jest.fn(async () => {
        throw new Error('follow-up failed')
      }),
    })
    await expect(sendInteractionFollowUp(client, input)).rejects.toThrow('edit failed')
  })
})

describe('buildInteractionFollowUpContent', () => {
  it('names the command it recorded', () => {
    const dispatch = readDispatchableInteraction(slashCommand(), { now }) as DispatchableInteraction
    const content = buildInteractionFollowUpContent(
      dispatch,
      createTranslator({ 'channel_discord.interactions.commandReceived': 'Zapisano /{command}.' }),
    )
    expect(content).toBe('Zapisano /mercato.')
  })

  it('answers in English rather than echoing a key when no dictionary is loaded', () => {
    const dispatch = readDispatchableInteraction(slashCommand(), { now }) as DispatchableInteraction
    const content = buildInteractionFollowUpContent(dispatch, createTranslator({}))
    expect(content).toContain('/mercato')
    expect(content).not.toContain('channel_discord.interactions')
  })
})
