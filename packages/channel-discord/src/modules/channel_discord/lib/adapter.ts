import type {
  ChannelAdapter,
  ChannelNativeContent,
  ContactHint,
  ConvertOutboundInput,
  DeleteChannelMessageInput,
  EditChannelMessageInput,
  FetchHistoryInput,
  GetMessageStatusInput,
  HistoryPage,
  InboundMessage,
  InboundReactionEvent,
  MessageStatus,
  NormalizedInboundMessage,
  RemoveReactionInput,
  ResolveContactInput,
  SendMessageInput,
  SendMessageResult,
  SendReactionInput,
  ValidateCredentialsInput,
  ValidateCredentialsResult,
  VerifyWebhookInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { discordCapabilities } from './capabilities'
import { parseDiscordCredentialsOrThrow, discordCredentialsSchema } from './credentials'
import {
  DiscordApiError,
  getDiscordRestClient,
  type DiscordMessageObject,
} from './discord-rest'
import { convertOutboundForDiscord } from './convert-outbound'
import {
  DISCORD_CONVERSATION_PREFIX,
  normalizeInboundDiscordMessage,
} from './normalize-inbound'
import {
  parseInteractionBody,
  verifyDiscordSignature,
} from './interactions-verify'

/**
 * Discord `ChannelAdapter` (SPEC 2026-06-19).
 *
 * Transport split:
 *   - Outbound: Discord REST API (`sendMessage`, edit/delete/reactions).
 *   - Inbound messages: a provider-owned **Gateway worker** pushes
 *     `MESSAGE_CREATE` events into the hub's ingest command — NOT this
 *     `verifyWebhook` hook (Discord does not POST normal messages to a webhook).
 *   - Slash commands / buttons: a signed **Interactions** endpoint
 *     (`api/post/channel_discord/interactions`) with Ed25519 verification.
 *
 * `verifyWebhook` security contract (fail-closed): the shared
 * `api/post/webhook/[provider]` route treats a non-throwing return as "verified".
 * For a Discord interaction body we verify the Ed25519 signature and THROW on any
 * failure; for a non-interaction body (a normal message never arrives here) we
 * return `eventType: 'other'` so the generic route acks without tenant-scoped
 * work. Live PING→PONG handshakes are served by the dedicated interactions route,
 * which can answer synchronously (the generic route only 202-acks).
 */
class DiscordChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'discord'
  readonly channelType = 'discord'
  readonly capabilities = discordCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = parseDiscordCredentialsOrThrow(input.credentials)

    let native: ChannelNativeContent
    try {
      native = await convertOutboundForDiscord({
        body: input.content.text ?? input.content.html ?? '',
        bodyFormat: input.content.bodyFormat ?? (input.content.html ? 'html' : 'text'),
        attachments: input.content.attachments,
        channelMetadata: input.metadata,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound conversion failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }

    const targetChannelId = resolveTargetChannelId(input, credentials.defaultChannelId)
    if (!targetChannelId) {
      return {
        externalMessageId: '',
        status: 'failed',
        error: '[internal] Discord send requires a target channel id (conversationId or defaultChannelId)',
      }
    }

    const meta = (native.metadata ?? {}) as Record<string, unknown>
    try {
      const message = await getDiscordRestClient().createMessage(
        { botToken: credentials.botToken },
        {
          channelId: targetChannelId,
          content: native.content.text ?? '',
          messageReferenceId: typeof meta.messageReferenceId === 'string' ? meta.messageReferenceId : undefined,
          allowedMentions: (meta.allowedMentions as Record<string, unknown> | undefined) ?? { parse: [] },
        },
      )
      return {
        externalMessageId: message.id,
        conversationId: `${DISCORD_CONVERSATION_PREFIX}${message.channel_id}`,
        status: 'sent',
        metadata: { discordChannelId: message.channel_id, discordMessageId: message.id },
      }
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 401) {
        // Protocol sentinel the hub keys on (error-classification.isReauthError).
        return { externalMessageId: '', status: 'failed', error: 'requires_reauth' }
      }
      const message = error instanceof Error ? error.message : 'Discord send failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<InboundMessage> {
    const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf-8')
    const interaction = parseInteractionBody(rawBody)
    if (!interaction) {
      // Not an interaction payload — Discord messages arrive via the gateway
      // worker, so ack (202) without tenant-scoped work.
      return { raw: {}, eventType: 'other', metadata: { reason: 'discord-uses-gateway-for-messages' } }
    }

    const parsed = discordCredentialsSchema.safeParse(input.credentials)
    const publicKeyHex = parsed.success ? parsed.data.publicKey : ''
    const headers = normalizeHeaders(input.headers)
    const ok = verifyDiscordSignature({
      publicKeyHex,
      signatureHex: headers['x-signature-ed25519'],
      timestamp: headers['x-signature-timestamp'],
      rawBody,
    })
    if (!ok) {
      // FAIL-CLOSED: throwing makes the shared route reject (401) and pins nothing.
      throw new Error('[internal] Discord interaction signature verification failed')
    }
    // Verified interaction. The generic hub route cannot answer the synchronous
    // PING→PONG handshake, so real interactions are served by the dedicated
    // `api/post/channel_discord/interactions` route; here we only prove the
    // signature and ack.
    return { raw: { discordInteraction: interaction }, eventType: 'other', metadata: { interactionType: interaction.type } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    // Discord exposes no per-message delivery-status API; best-effort placeholder.
    return { status: 'sent' }
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    return convertOutboundForDiscord(input)
  }

  async normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage> {
    const message = pickDiscordMessage(raw)
    return normalizeInboundDiscordMessage(message)
  }

  async normalizeInboundReaction(raw: InboundMessage): Promise<InboundReactionEvent> {
    const payload = (raw.raw?.discordReaction ?? raw.raw) as {
      message_id?: string
      channel_id?: string
      emoji?: { name?: string; id?: string | null }
      user_id?: string
      member?: { user?: { username?: string; global_name?: string | null } }
      action?: 'added' | 'removed'
    }
    const emojiName = payload.emoji?.name ?? ''
    const emoji = payload.emoji?.id ? `${emojiName}:${payload.emoji.id}` : emojiName
    return {
      externalMessageId: payload.message_id ?? '',
      externalConversationId: payload.channel_id
        ? `${DISCORD_CONVERSATION_PREFIX}${payload.channel_id}`
        : undefined,
      emoji,
      userIdentifier: payload.user_id ?? 'unknown',
      userDisplayName: payload.member?.user?.global_name ?? payload.member?.user?.username,
      action: payload.action === 'removed' ? 'removed' : 'added',
      raw: payload as Record<string, unknown>,
    }
  }

  async sendReaction(input: SendReactionInput): Promise<void> {
    const credentials = parseDiscordCredentialsOrThrow(input.credentials)
    const channelId = stripConversationPrefix(input.conversationId) ?? credentials.defaultChannelId
    if (!channelId) throw new Error('[internal] Discord sendReaction requires a channel id')
    await getDiscordRestClient().addReaction(
      { botToken: credentials.botToken },
      channelId,
      input.externalMessageId,
      input.emoji,
    )
  }

  async removeReaction(input: RemoveReactionInput): Promise<void> {
    const credentials = parseDiscordCredentialsOrThrow(input.credentials)
    const channelId = stripConversationPrefix(input.conversationId) ?? credentials.defaultChannelId
    if (!channelId) throw new Error('[internal] Discord removeReaction requires a channel id')
    await getDiscordRestClient().removeReaction(
      { botToken: credentials.botToken },
      channelId,
      input.externalMessageId,
      input.emoji,
    )
  }

  async editMessage(input: EditChannelMessageInput): Promise<void> {
    const credentials = parseDiscordCredentialsOrThrow(input.credentials)
    const channelId = stripConversationPrefix(input.conversationId) ?? credentials.defaultChannelId
    if (!channelId) throw new Error('[internal] Discord editMessage requires a channel id')
    const content = input.newContent.text ?? input.newContent.html ?? ''
    await getDiscordRestClient().editMessage(
      { botToken: credentials.botToken },
      channelId,
      input.externalMessageId,
      content,
    )
  }

  async deleteMessage(input: DeleteChannelMessageInput): Promise<void> {
    const credentials = parseDiscordCredentialsOrThrow(input.credentials)
    const channelId = stripConversationPrefix(input.conversationId) ?? credentials.defaultChannelId
    if (!channelId) throw new Error('[internal] Discord deleteMessage requires a channel id')
    await getDiscordRestClient().deleteMessage(
      { botToken: credentials.botToken },
      channelId,
      input.externalMessageId,
    )
  }

  async fetchHistory(input: FetchHistoryInput): Promise<HistoryPage> {
    const credentials = parseDiscordCredentialsOrThrow(input.credentials)
    const channelId = stripConversationPrefix(input.conversationId) ?? credentials.defaultChannelId
    if (!channelId) {
      return { messages: [], hasMore: false }
    }
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
    const raw = await getDiscordRestClient().listMessages(
      { botToken: credentials.botToken },
      channelId,
      { before: input.cursor, limit },
    )
    // Discord returns newest-first; keep that order but expose the oldest id as
    // the next `before` cursor for backward pagination.
    const messages = raw.map((message) => normalizeInboundDiscordMessage(message))
    const oldest = raw.length > 0 ? raw[raw.length - 1].id : undefined
    return {
      messages,
      nextCursor: raw.length >= limit ? oldest : undefined,
      hasMore: raw.length >= limit,
    }
  }

  async resolveContact(input: ResolveContactInput): Promise<ContactHint | null> {
    const userId = input.senderIdentifier
    if (!userId || userId === 'unknown') return null
    const displayName =
      input.senderDisplayName ||
      (typeof input.channelMetadata?.discordAuthorUsername === 'string'
        ? (input.channelMetadata.discordAuthorUsername as string)
        : undefined)
    return {
      displayName,
      externalProfileUrl: `https://discord.com/users/${encodeURIComponent(userId)}`,
    }
  }

  async validateCredentials(input: ValidateCredentialsInput): Promise<ValidateCredentialsResult> {
    const parsed = discordCredentialsSchema.safeParse(input.credentials)
    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const path = issue.path[0]
        if (typeof path !== 'string') continue
        if (!errors[path]) errors[path] = issue.message
      }
      return { ok: false, errors }
    }
    try {
      await getDiscordRestClient().getCurrentUser({ botToken: parsed.data.botToken })
      return { ok: true }
    } catch (error) {
      const status = error instanceof DiscordApiError ? error.status : 0
      return {
        ok: false,
        errors: {
          botToken:
            status === 401
              ? 'Discord rejected the bot token. Reset it in the Developer Portal and paste the new value.'
              : 'Could not reach Discord to validate the bot token. Check the token and try again.',
        },
      }
    }
  }
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    out[key.toLowerCase()] = Array.isArray(value) ? (value[0] ?? '') : value
  }
  return out
}

function stripConversationPrefix(conversationId: string | undefined): string | undefined {
  if (!conversationId) return undefined
  return conversationId.startsWith(DISCORD_CONVERSATION_PREFIX)
    ? conversationId.slice(DISCORD_CONVERSATION_PREFIX.length)
    : conversationId
}

function resolveTargetChannelId(input: SendMessageInput, defaultChannelId: string | undefined): string | undefined {
  const fromMeta = input.metadata?.discordChannelId
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta
  const fromConversation = stripConversationPrefix(input.conversationId)
  if (fromConversation && fromConversation.length > 0) return fromConversation
  return defaultChannelId
}

function pickDiscordMessage(raw: InboundMessage): DiscordMessageObject {
  const candidate = (raw.raw?.discordMessage ?? raw.raw) as DiscordMessageObject | undefined
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string') {
    throw new Error('[internal] Discord normalizeInbound requires `raw.discordMessage` to be a Discord message object')
  }
  return candidate
}

let cachedAdapter: DiscordChannelAdapter | null = null

export function getDiscordChannelAdapter(): DiscordChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new DiscordChannelAdapter()
  return cachedAdapter
}

export { DiscordChannelAdapter }
