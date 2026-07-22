import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ImapCredentials } from './credentials'

/**
 * Single source of truth for the cleartext-transport policy.
 *
 * `imapTls`/`smtpTls === 'none'` disables TLS entirely and sends the password in
 * the clear over an attacker-controlled host string. The credential schema still
 * *permits* `'none'`, so this guard — not the schema — is what actually rejects
 * it. Centralizing it here lets every code path (validate, health, send, poll,
 * import) enforce one rule: a stored blob with `'none'` is refused on every
 * connection build unless an operator opts in via
 * `OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT=true`. `'starttls'`/`'tls'` are
 * always allowed.
 */

export const INSECURE_TRANSPORT_MESSAGE =
  'Cleartext transport (None) is not allowed. Use STARTTLS or implicit TLS. ' +
  'An operator must set OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT=true to permit it.'

export function isInsecureTransportAllowed(): boolean {
  return parseBooleanWithDefault(process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT, false)
}

/**
 * Throws when either transport is cleartext (`'none'`) and the operator opt-in
 * flag is unset. Called inside the credentials → connection translators so it
 * runs on every IMAP/SMTP connection build — including reads of credential blobs
 * persisted while the flag was set, or written via a path that bypassed
 * `validateImapCredentials`.
 */
export function assertTransportAllowed(credentials: Pick<ImapCredentials, 'imapTls' | 'smtpTls'>): void {
  if (isInsecureTransportAllowed()) return
  if (credentials.imapTls === 'none' || credentials.smtpTls === 'none') {
    throw new Error(`[internal] ${INSECURE_TRANSPORT_MESSAGE}`)
  }
}
