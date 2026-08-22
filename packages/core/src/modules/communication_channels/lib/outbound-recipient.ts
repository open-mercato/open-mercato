import { z } from 'zod'
import type { ChannelCapabilities } from './adapter'

/**
 * Upper bound shared by both recipient shapes. 320 is the RFC 5321 maximum for
 * an email address (64 local + `@` + 255 domain); provider-native identifiers
 * are far shorter, so one ceiling covers both.
 */
export const MAX_OUTBOUND_RECIPIENT_LENGTH = 320

const emailRecipientSchema = z.string().email()

/**
 * Characters a provider-native recipient may contain. This is an allowlist, not a
 * denylist, because the recipient reaches adapters that interpolate it into a REST
 * path (Discord posts to `/channels/{recipient}/messages`), and a denylist fails
 * open on every character nobody thought of — percent-encoded separators
 * (`%2F`, `%2e%2e%2f`) and control bytes (NUL, DEL) all walked through the
 * previous `[\r\n\s/\\?#]` class. An allowlist fails closed instead: the worst
 * case is a provider whose identifier alphabet needs widening, which is a
 * reviewable one-line change rather than a silent path-steering primitive.
 *
 * The set covers every provider-native identifier shape the hub has to carry
 * today — Discord snowflakes (digits), Slack-style ids (alphanumerics), and email
 * addresses, since `'provider-native'` must never narrow what `'email'` accepts.
 */
const PROVIDER_NATIVE_ALLOWED = /^[A-Za-z0-9._:@+-]+$/

export type OutboundRecipientCheck = { ok: true } | { ok: false; error: string }

/**
 * Validate an outbound recipient against the provider's declared recipient
 * shape.
 *
 * The hub used to hard-wire `z.string().email()` on every outbound endpoint,
 * which left providers whose recipients are not email addresses with no product
 * path to send at all (#4976). Validation now follows the adapter's
 * `capabilities.recipientFormat`, defaulting to `'email'` so every existing
 * provider keeps byte-identical behavior.
 */
export function validateOutboundRecipient(
  recipient: unknown,
  capabilities: Pick<ChannelCapabilities, 'recipientFormat'> | null | undefined,
): OutboundRecipientCheck {
  if (typeof recipient !== 'string' || recipient.length === 0) {
    return { ok: false, error: 'Recipient is required' }
  }
  if (recipient.length > MAX_OUTBOUND_RECIPIENT_LENGTH) {
    return {
      ok: false,
      error: `Recipient must be at most ${MAX_OUTBOUND_RECIPIENT_LENGTH} characters`,
    }
  }
  if (capabilities?.recipientFormat !== 'provider-native') {
    return emailRecipientSchema.safeParse(recipient).success
      ? { ok: true }
      : { ok: false, error: 'Recipient must be a valid email address' }
  }
  if (!PROVIDER_NATIVE_ALLOWED.test(recipient)) {
    return {
      ok: false,
      error: 'Recipient may only contain letters, digits, and the characters . _ : @ + -',
    }
  }
  // `.` is allowed (email addresses need it), so traversal still has to be
  // rejected explicitly even though the separators it would need are not.
  if (recipient.includes('..')) {
    return { ok: false, error: 'Recipient must not contain ".."' }
  }
  return { ok: true }
}
