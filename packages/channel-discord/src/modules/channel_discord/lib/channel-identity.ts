/**
 * The two strings that identify this provider to the hub, in one dependency-free
 * module so the adapter and every caller that has to declare them import the
 * same literal.
 *
 * They were duplicated as inline literals before, and #5601 is what that costs:
 * the AI auto-reply composed a `channel.discord` message without telling the
 * validator which channel type it originated from. `channelTypeRequiresExternalEmail`
 * fails closed on an absent type, so the hub demanded an `externalEmail` from a
 * Discord sender — who is a snowflake and has no address — and every automatic
 * reply died in validation.
 */

/** Provider key persisted on `communication_channels.provider_key`. */
export const DISCORD_PROVIDER_KEY = 'discord'

/**
 * Channel type the hub reasons about. It is the value
 * `NON_EMAIL_SENDER_CHANNEL_TYPES` recognizes (`messages/lib/channel-sender-identity.ts`),
 * so any compose that omits it silently re-acquires the `externalEmail`
 * requirement this provider cannot satisfy.
 */
export const DISCORD_CHANNEL_TYPE = 'discord'
