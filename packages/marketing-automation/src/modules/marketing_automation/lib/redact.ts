/**
 * Removes recipient identity from text that will be persisted or returned.
 *
 * Third-party failure text is the one path by which an address reaches storage in this module. Every
 * other path was designed to keep it out: `marketing_campaign_runs.context` carries no email,
 * `marketing_message_sends` carries no address, the dry run refuses to return one. But a transport
 * rejection says `550 5.1.1 <someone@example.com>: Recipient address rejected`, and copying that
 * verbatim into `last_error` and the step log creates an unencrypted mirror of a column the platform
 * encrypts — readable by anyone with `runs.view` and by anyone with a database replica.
 *
 * Deliberately a blunt instrument. It cannot know which substring is the recipient, so it removes
 * anything shaped like an address, and the cost of over-redacting an error message is far below the
 * cost of leaking one address.
 */

/** Conservative: local@domain.tld, the shape every transport quotes. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export const REDACTED_EMAIL = '[redacted-email]'

export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, REDACTED_EMAIL)
}

/**
 * Redacts and truncates a failure message for storage.
 *
 * Truncation is second, so a long transport response cannot push an address past the cut and back into
 * the clear by being trimmed at a different point.
 */
export function redactForStorage(text: string, maxLength: number): string {
  return redactEmails(text).slice(0, maxLength)
}

/**
 * Redacts a whole payload, not just a line of failure text.
 *
 * Needed because a dead letter stores the EVENT that failed, and an inbound hook's event carries every key a
 * partner posted — so the interesting addresses are in the data rather than in the error message. Walks strings
 * wherever they are, keeps the shape so the record is still diagnosable, and caps the depth for the same reason
 * the occurrence key does: the payload is somebody else's JSON.
 */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[too deep]'
  if (typeof value === 'string') return redactEmails(value)
  if (Array.isArray(value)) return value.map((entry) => redactPayload(entry, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactPayload(entry, depth + 1)
    }
    return out
  }
  return value
}
