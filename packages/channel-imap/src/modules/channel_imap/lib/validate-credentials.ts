import type { ValidateCredentialsResult } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { imapCredentialsSchema } from './credentials'
import {
  credentialsToConnection,
  getImapClient,
} from './imap-client'
import {
  credentialsToSmtpConnection,
  getSmtpClient,
} from './smtp-client'
import { INSECURE_TRANSPORT_MESSAGE, isInsecureTransportAllowed } from './transport'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('channel_imap')

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

  // Reject cleartext transport by default. The shared `transport` helper is the
  // single source of truth for the policy (and enforces it again at connection
  // build time for every op); here we surface it as field-level errors so the
  // connect form can inline-highlight the offending TLS selector without
  // touching the network.
  if (!isInsecureTransportAllowed()) {
    const insecureTransportErrors: Record<string, string> = {}
    if (credentials.imapTls === 'none') insecureTransportErrors.imapTls = INSECURE_TRANSPORT_MESSAGE
    if (credentials.smtpTls === 'none') insecureTransportErrors.smtpTls = INSECURE_TRANSPORT_MESSAGE
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
  // Keep the coarse classification but never echo raw upstream server text
  // (banners, internal hostnames) back to the client. Log the full original
  // message server-side for diagnostics instead.
  const message = error instanceof Error ? error.message : String(error ?? '')
  logger.warn('Credential validation failed', { message })
  if (/auth|login|credentials|535|454|530/i.test(message)) {
    return 'Authentication rejected by the server. Check the username and password.'
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return 'Could not reach the server. Check the host and port.'
  }
  return fallback
}
