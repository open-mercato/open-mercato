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
