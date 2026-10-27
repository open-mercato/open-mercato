import type { InboundProcessorPayload } from '@open-mercato/core/modules/communication_channels/workers/inbound-processor'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { DISCORD_MAX_BODY_LENGTH } from './capabilities'
import type { DiscordMessageObject, DiscordRestClient, DiscordUser } from './discord-rest'
import { buildInboundMessageJob, type GatewayChannelScope } from './gateway-bridge'
import { DiscordInteractionType, type ParsedInteraction } from './interactions-verify'

/**
 * Everything the dispatch path needs from a verified interaction, extracted once
 * so nothing downstream has to re-read the untrusted body.
 *
 * This shape crosses a queue boundary (the HTTP route must answer Discord within
 * three seconds, so the hub write and the follow-up REST call happen in a
 * worker), which is why it carries no credential: `token` is the interaction's
 * own short-lived webhook credential and the bot token is re-resolved from the
 * encrypted credential store on the other side.
 */
export interface DispatchableInteraction {
  /** Interaction snowflake — also the hub's `externalMessageId`, so redelivery dedups. */
  id: string
  /** Interaction webhook token. Valid for 15 minutes, single interaction. */
  token: string
  type: number
  applicationId: string
  /** Discord text channel the interaction happened in. */
  discordChannelId: string
  guildId?: string
  user: DiscordUser
  /** Slash-command name, for `APPLICATION_COMMAND` / autocomplete. */
  commandName?: string
  /** Component / modal `custom_id`, for `MESSAGE_COMPONENT` / `MODAL_SUBMIT`. */
  customId?: string
  /** Human-readable rendering of what the user did — the hub message body. */
  content: string
  /** ISO timestamp the hub message is stamped with. */
  timestamp: string
}

/** The interaction types this provider turns into hub messages. */
export const DISPATCHABLE_INTERACTION_TYPES: readonly number[] = [
  DiscordInteractionType.APPLICATION_COMMAND,
  DiscordInteractionType.MESSAGE_COMPONENT,
  DiscordInteractionType.MODAL_SUBMIT,
]

export function isDispatchableInteractionType(type: number): boolean {
  return DISPATCHABLE_INTERACTION_TYPES.includes(type)
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readOptionValue(option: Record<string, unknown>): string {
  const value = option.value
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Flatten a slash command's options into `name:value` pairs.
 *
 * Discord nests subcommands and subcommand groups as options whose own `options`
 * array holds the real arguments, so a naive one-level read renders
 * `/support ticket:` and loses everything the user typed. Recursion is bounded by
 * Discord's own two-level nesting limit.
 */
function renderCommandOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  const rendered: string[] = []
  for (const entry of options) {
    if (!entry || typeof entry !== 'object') continue
    const option = entry as Record<string, unknown>
    const name = readString(option, 'name')
    if (!name) continue
    const nested = renderCommandOptions(option.options)
    if (nested.length > 0) {
      rendered.push(name, ...nested)
      continue
    }
    rendered.push(`${name}:${readOptionValue(option)}`)
  }
  return rendered
}

/** Values a select menu returned, or the fields a modal submitted. */
function renderComponentValues(data: Record<string, unknown> | undefined): string[] {
  if (!data) return []
  const values = data.values
  if (Array.isArray(values)) return values.map((value) => String(value))

  // Modal submissions nest one input per action row.
  const rows = data.components
  if (!Array.isArray(rows)) return []
  const rendered: string[] = []
  for (const row of rows) {
    const children = (row as { components?: unknown } | null)?.components
    if (!Array.isArray(children)) continue
    for (const child of children) {
      if (!child || typeof child !== 'object') continue
      const field = child as Record<string, unknown>
      const customId = readString(field, 'custom_id')
      const value = readString(field, 'value')
      if (!customId) continue
      rendered.push(`${customId}:${value ?? ''}`)
    }
  }
  return rendered
}

/**
 * Render an interaction as the text a human reading the hub inbox needs.
 *
 * A slash command becomes `/support message:the printer is jammed`; a button or
 * select becomes `[component] escalate` plus any selected values. The hub stores
 * the full interaction object in `channelPayload`, so this is a readable summary
 * rather than the record of truth.
 */
export function renderInteractionContent(interaction: ParsedInteraction): string {
  const data = interaction.data
  const commandName = readString(data, 'name')
  const customId = readString(data, 'custom_id')

  let rendered: string
  if (interaction.type === DiscordInteractionType.APPLICATION_COMMAND) {
    rendered = [`/${commandName ?? 'command'}`, ...renderCommandOptions(data?.options)].join(' ')
  } else if (interaction.type === DiscordInteractionType.MESSAGE_COMPONENT) {
    rendered = [`[component] ${customId ?? 'unknown'}`, ...renderComponentValues(data)].join(' ')
  } else if (interaction.type === DiscordInteractionType.MODAL_SUBMIT) {
    rendered = [`[modal] ${customId ?? 'unknown'}`, ...renderComponentValues(data)].join(' ')
  } else {
    rendered = `[interaction ${interaction.type}]`
  }

  return rendered.length > DISCORD_MAX_BODY_LENGTH ? rendered.slice(0, DISCORD_MAX_BODY_LENGTH) : rendered
}

/**
 * Narrow a verified interaction to the fields the dispatch needs, or `null` when
 * the payload cannot be dispatched at all.
 *
 * Returning `null` is not a rejection of the *caller* — the signature already
 * verified — it means Discord sent a shape this provider cannot turn into a hub
 * message (no channel, no invoking user, no follow-up token). The route answers
 * those with a visible message rather than a deferred ack it could never
 * replace.
 */
export function readDispatchableInteraction(
  interaction: ParsedInteraction,
  options?: { now?: Date },
): DispatchableInteraction | null {
  if (!isDispatchableInteractionType(interaction.type)) return null

  const id = typeof interaction.id === 'string' && interaction.id.length > 0 ? interaction.id : null
  const token = typeof interaction.token === 'string' && interaction.token.length > 0 ? interaction.token : null
  const applicationId =
    typeof interaction.application_id === 'string' && interaction.application_id.length > 0
      ? interaction.application_id
      : null
  const discordChannelId =
    typeof interaction.channel_id === 'string' && interaction.channel_id.length > 0 ? interaction.channel_id : null
  // A guild interaction carries the invoker under `member.user`; a DM carries it
  // directly under `user`.
  const rawUser = interaction.member?.user ?? interaction.user
  const userId = typeof rawUser?.id === 'string' && rawUser.id.length > 0 ? rawUser.id : null

  if (!id || !token || !applicationId || !discordChannelId || !userId) return null

  return {
    id,
    token,
    type: interaction.type,
    applicationId,
    discordChannelId,
    guildId: typeof interaction.guild_id === 'string' ? interaction.guild_id : undefined,
    user: {
      id: userId,
      username: rawUser?.username ?? userId,
      global_name: rawUser?.global_name ?? null,
    },
    commandName: readString(interaction.data, 'name'),
    customId: readString(interaction.data, 'custom_id'),
    content: renderInteractionContent(interaction),
    timestamp: (options?.now ?? new Date()).toISOString(),
  }
}

/**
 * Present the interaction as the raw Discord message object the hub's inbound
 * path already understands.
 *
 * WHY A SYNTHESIZED MESSAGE: the hub contract stays untouched. The inbound
 * processor calls `adapter.normalizeInbound` on whatever `raw` it is handed, so
 * shaping the interaction like a message means a slash command lands in the same
 * conversation, under the same tenant scope, with the same dedup key discipline
 * as anything typed in the channel — no hub-side special case for interactions.
 */
export function buildInteractionMessage(dispatch: DispatchableInteraction): DiscordMessageObject {
  return {
    id: dispatch.id,
    channel_id: dispatch.discordChannelId,
    guild_id: dispatch.guildId,
    content: dispatch.content,
    author: dispatch.user,
    timestamp: dispatch.timestamp,
    discord_interaction: {
      id: dispatch.id,
      type: dispatch.type,
      applicationId: dispatch.applicationId,
      commandName: dispatch.commandName,
      customId: dispatch.customId,
    },
  }
}

/**
 * Build the hub inbound-processor job for a dispatchable interaction — the same
 * job shape, on the same queue, that the gateway worker produces for a typed
 * message. Returns `null` when the interaction was invoked by a bot (the
 * feedback-loop guard `buildInboundMessageJob` owns).
 */
export function buildInteractionInboundJob(input: {
  dispatch: DispatchableInteraction
  channel: GatewayChannelScope
  botUserId?: string
}): InboundProcessorPayload | null {
  return buildInboundMessageJob({
    message: buildInteractionMessage(input.dispatch),
    channel: input.channel,
    botUserId: input.botUserId,
  })
}

/**
 * Copy shown to the user in Discord once the interaction has been recorded.
 *
 * Takes the translator rather than resolving one, so the pure builder stays
 * usable from the worker, from the route and from a test with no module
 * registry. Each key carries its English fallback: a worker process that never
 * loaded the app dictionaries must still say something a human can read, not
 * echo a translation key back into a Discord channel.
 */
export function buildInteractionFollowUpContent(dispatch: DispatchableInteraction, t: TranslateFn): string {
  if (dispatch.type === DiscordInteractionType.APPLICATION_COMMAND) {
    return t(
      'channel_discord.interactions.commandReceived',
      'Received — `/{command}` is now in the Open Mercato inbox and someone will pick it up from there.',
      { command: dispatch.commandName ?? '' },
    )
  }
  return t(
    'channel_discord.interactions.componentReceived',
    'Received — your response is now in the Open Mercato inbox and someone will pick it up from there.',
  )
}

/**
 * Replace the deferred acknowledgement with a real message.
 *
 * ORDER MATTERS: editing the original response is what actually ends Discord's
 * "thinking…" state, so it is tried first. A follow-up POST is the fallback for
 * the case where the original response is already gone (Discord answers 404),
 * which still gets the user a visible answer instead of a spinner that never
 * resolves.
 *
 * Returns which call delivered the message so the worker can log it; throws only
 * when neither did, letting the queue's retry policy have another go inside the
 * interaction token's 15-minute lifetime.
 */
export async function sendInteractionFollowUp(
  client: DiscordRestClient,
  input: { applicationId: string; interactionToken: string; content: string; ephemeral?: boolean },
): Promise<'edited-original' | 'follow-up'> {
  const body = { content: input.content, ephemeral: input.ephemeral }
  try {
    await client.editOriginalInteractionResponse(input.applicationId, input.interactionToken, body)
    return 'edited-original'
  } catch (editError) {
    try {
      await client.createInteractionFollowUp(input.applicationId, input.interactionToken, body)
      return 'follow-up'
    } catch {
      throw editError
    }
  }
}
