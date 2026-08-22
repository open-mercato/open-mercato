import { channelTypeRequiresExternalEmail } from '../../messages/lib/channel-sender-identity'

/**
 * How the hub validates the recipient of a diagnostic test send.
 *
 * Background (#4976): `test-send` declared `to: z.string().email()`, which is
 * correct for a mailbox and wrong for every other channel. A Discord recipient
 * is a channel snowflake (`1534331920463433771`), a Slack one is a channel id —
 * neither parses as an address, so the documented outbound smoke test returned
 * 422 before the adapter was ever reached. The adapters themselves were fine:
 * QA replayed the exact REST contract `discord-rest.ts` builds and Discord
 * accepted it. Nothing in the product could ask them to run.
 *
 * The rule is the mirror of the inbound one (#4975) and uses the same
 * fail-closed predicate, so a single list decides both directions: only a
 * channel type positively recognized as non-email accepts a free-form
 * recipient. An unknown, empty or absent channel type keeps the address
 * requirement, so no existing caller changes behaviour.
 */
export type OutboundRecipientResolution =
  | { ok: true; to: string | undefined }
  | { ok: false; error: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate a test-send recipient against the channel it is being sent through.
 *
 * On an email-typed channel `to` stays mandatory and must be an address — the
 * pre-#4976 contract, byte for byte. On a recognized non-email channel `to` is
 * a free-form provider-native identifier and may be omitted entirely, in which
 * case the adapter falls back to its own configured default target (for Discord
 * that is `defaultChannelId`, which is exactly what its help text promises).
 */
export function resolveTestSendRecipient(
  channelType: string | null | undefined,
  to: string | undefined,
): OutboundRecipientResolution {
  const trimmed = typeof to === 'string' ? to.trim() : undefined

  if (channelTypeRequiresExternalEmail(channelType)) {
    if (!trimmed) return { ok: false, error: 'to is required for an email channel' }
    if (!EMAIL_PATTERN.test(trimmed)) return { ok: false, error: 'Invalid email address' }
    return { ok: true, to: trimmed }
  }

  return { ok: true, to: trimmed && trimmed.length > 0 ? trimmed : undefined }
}
