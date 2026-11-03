/**
 * How the hub decides whether an external correspondent must be identified by an
 * email address.
 *
 * Background (#4975): `composeMessageSchema` used to require `externalEmail` for
 * every non-draft message with `visibility: 'public'` — which is every message
 * from an external sender. That assumption holds only for email-typed channels.
 * A Discord sender is a snowflake and has no address at all, so inbound Discord
 * failed validation deterministically and the ingest job died in the queue while
 * the channel still reported `Connected`.
 *
 * Variant A of the spec's § Open decision — hub sender-identity contract makes
 * the requirement conditional on the originating channel type, and **fails
 * closed**: only a channel type this list positively recognizes as non-email
 * waives the requirement. An unrecognized, empty or absent channel type keeps
 * the pre-existing behaviour, so no current caller changes and a typo'd or
 * caller-asserted type cannot quietly switch a validation rule off.
 *
 * For these channels the sender identity is not lost — it is carried by
 * `ExternalMessage.sender_identifier` and joined 1:1 to the platform message
 * through `MessageChannelLink`.
 *
 * Adding a channel type here is additive and non-breaking: it only widens the
 * set of inputs the hub accepts.
 */
const NON_EMAIL_SENDER_CHANNEL_TYPES = new Set([
  'discord',
  'slack',
  'teams',
  'telegram',
  'signal',
  'whatsapp',
  'messenger',
  'instagram',
  'sms',
  'push',
])

/**
 * True when a message originating from `channelType` must carry an
 * `externalEmail` to be composed with `visibility: 'public'`.
 *
 * Fail-closed by design — see the note above.
 */
export function channelTypeRequiresExternalEmail(channelType?: string | null): boolean {
  if (typeof channelType !== 'string') return true
  const normalized = channelType.trim().toLowerCase()
  if (!normalized) return true
  return !NON_EMAIL_SENDER_CHANNEL_TYPES.has(normalized)
}

/** The recognized non-email channel types, for tests and diagnostics. */
export function listNonEmailSenderChannelTypes(): string[] {
  return Array.from(NON_EMAIL_SENDER_CHANNEL_TYPES).sort((left, right) => left.localeCompare(right))
}
