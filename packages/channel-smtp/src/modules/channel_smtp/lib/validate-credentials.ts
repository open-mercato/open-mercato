import type { ValidateCredentialsResult } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { smtpCredentialsSchema } from './credentials'
import { credentialsToConnection, getSmtpTransport } from './transport'

const logger = createLogger('channel_smtp')

const PROBE_TIMEOUT_MS = 8_000

/**
 * Validate SMTP relay credentials before the hub persists them.
 *
 * The connect command accepts adapters without this method optimistically, which
 * for a provider whose host is operator-supplied would mean a loopback relay or a
 * cleartext transport is saved and only refused later, at send time. The schema
 * already encodes both refusals, so surfacing them here turns them into
 * field-level errors the connect form can inline-highlight — the same two-layer
 * treatment `channel-imap` gives the identical surface.
 *
 * Then `verify()` runs a real handshake plus AUTH, so a typo'd host or a rejected
 * password fails at setup rather than on the first transactional email.
 */
export async function validateSmtpCredentials(
  rawCredentials: unknown,
): Promise<ValidateCredentialsResult> {
  const parsed = smtpCredentialsSchema.safeParse(rawCredentials ?? {})
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

  const connection = { ...credentialsToConnection(parsed.data), timeoutMs: PROBE_TIMEOUT_MS }
  try {
    await getSmtpTransport().verify(connection)
  } catch (error) {
    return { ok: false, errors: { password: classifyAuthError(error) } }
  }

  return { ok: true }
}

function classifyAuthError(error: unknown): string {
  // Never echo raw relay text (banners, internal hostnames) back to the client;
  // keep the full message server-side for diagnostics.
  const message = error instanceof Error ? error.message : String(error ?? '')
  logger.warn('SMTP credential validation failed', { message })
  if (/auth|login|credentials|535|454|530/i.test(message)) {
    return 'Authentication rejected by the relay. Check the username and password.'
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return 'Could not reach the relay. Check the host and port.'
  }
  return 'SMTP relay refused the credentials.'
}
