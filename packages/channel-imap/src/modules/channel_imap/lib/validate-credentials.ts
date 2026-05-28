import type { ValidateCredentialsResult } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { imapCredentialsSchema } from './credentials'
import {
  credentialsToConnection,
  getImapClient,
} from './imap-client'
import {
  credentialsToSmtpConnection,
  getSmtpClient,
} from './smtp-client'

/**
 * Validate IMAP+SMTP credentials by attempting a live LOGIN on both servers.
 *
 * Strategy:
 *   1. Zod-parse the credential payload — returns shape errors first.
 *   2. Open IMAP, capture capabilities, log out.
 *   3. Run SMTP `verify` (extends EHLO, optional STARTTLS, AUTH LOGIN ping).
 *
 * Returns `{ ok: false, errors }` with field-level messages so the hub can pass
 * them straight to `createCrudFormError` and the CrudForm inline-highlights the
 * offending input. Returns `{ ok: true }` only when both servers accept the login.
 */

export async function validateImapCredentials(
  rawCredentials: unknown,
): Promise<ValidateCredentialsResult> {
  const parsed = imapCredentialsSchema.safeParse(rawCredentials)
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]
      if (typeof path !== 'string') continue
      // First error wins per field — CrudForm only renders one per field anyway.
      if (!errors[path]) errors[path] = issue.message
    }
    return { ok: false, errors }
  }

  const credentials = parsed.data

  // Reject cleartext transport by default. `'none'` disables TLS entirely and
  // sends the password in the clear — unacceptable for an attacker-controlled
  // host string. Operators who genuinely need it (a trusted private-network
  // testing host) must explicitly opt in via
  // `OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT=true`. `'starttls'`/`'tls'` are
  // always allowed.
  const allowInsecureTransport = parseBooleanWithDefault(
    process.env.OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT,
    false,
  )
  if (!allowInsecureTransport) {
    const insecureTransportErrors: Record<string, string> = {}
    const insecureMessage =
      'Cleartext transport (None) is not allowed. Use STARTTLS or implicit TLS. ' +
      'An operator must set OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT=true to permit it.'
    if (credentials.imapTls === 'none') insecureTransportErrors.imapTls = insecureMessage
    if (credentials.smtpTls === 'none') insecureTransportErrors.smtpTls = insecureMessage
    if (Object.keys(insecureTransportErrors).length > 0) {
      return { ok: false, errors: insecureTransportErrors }
    }
  }

  const imap = getImapClient()
  const smtp = getSmtpClient()

  try {
    await imap.connectAndValidate(credentialsToConnection(credentials))
  } catch (error) {
    return {
      ok: false,
      errors: {
        imapPassword: classifyAuthError(error, 'IMAP login failed.'),
      },
    }
  }

  try {
    await smtp.verify(credentialsToSmtpConnection(credentials))
  } catch (error) {
    return {
      ok: false,
      errors: {
        smtpPassword: classifyAuthError(error, 'SMTP login failed.'),
      },
    }
  }

  return { ok: true }
}

function classifyAuthError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/auth|login|credentials|535|454|530/i.test(message)) {
    return `Authentication rejected by server: ${message}`
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return `Could not reach server: ${message}`
  }
  return `${fallback} ${message}`
}
