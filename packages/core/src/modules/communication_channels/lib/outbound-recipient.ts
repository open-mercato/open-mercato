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
 * Characters a provider-native recipient may never contain. CR/LF is the header
 * injection guard (the same one `send-as-user` applies to subject/threading
 * fields); the path separators and `..` stop a caller from steering an adapter
 * that interpolates the recipient into a REST path (Discord posts to
 * `/channels/{recipient}/messages`) at a different resource.
 */
const UNSAFE_PROVIDER_NATIVE = /[\r\n\s/\\?#]/

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
  if (UNSAFE_PROVIDER_NATIVE.test(recipient)) {
    return {
      ok: false,
      error: 'Recipient must not contain whitespace, line breaks, or URL path characters',
    }
  }
  if (recipient.includes('..')) {
    return { ok: false, error: 'Recipient must not contain ".."' }
  }
  return { ok: true }
}
