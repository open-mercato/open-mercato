/**
 * The tenant's ElevenLabs configuration, as stored in the `integrations`
 * credential store and as the connector consumes it.
 *
 * Nothing in this file touches the database or the container: it is the pure
 * shape + parse half, so the connector can be unit-tested with a fake reader and
 * so a mis-typed credential produces one clear error instead of an `undefined`
 * reaching the ElevenLabs API. The DB-backed reader lives in
 * `credentialsReader.ts` and is wired from `di.ts`.
 *
 * SECRET HANDLING: `apiKey` and `webhookSecret` are `type: 'secret'` fields
 * (see `integration.ts`), encrypted at rest by the credential store. Nothing in
 * this package ever puts either value into a log line, an error message or an
 * event payload — `describeCredentialsForLog` is the only thing allowed near a
 * logger, and it emits presence booleans and non-secret ids only.
 */

/** Which ElevenLabs outbound-call endpoint this tenant's number is wired to. */
export type ElevenLabsTelephonyProvider = 'twilio' | 'sip_trunk'

export type ElevenLabsCredentials = {
  apiKey: string
  webhookSecret: string
  agentId: string
  agentPhoneNumberId: string
  telephonyProvider: ElevenLabsTelephonyProvider
  /**
   * Optional caller id presented to the callee, passed through as
   * `telephony_call_config.caller_id` when set. Purely a default: the workflow
   * never chooses it, because "who is calling" is a tenant-level compliance
   * decision, not a per-run one.
   */
  defaultCallerId: string | null
  /**
   * Tenant default for `call_recording_enabled`. `null` means "say nothing and
   * let the ElevenLabs agent's own setting stand" — deliberately distinct from
   * `false`, because recording consent is regulated (design R6) and silently
   * flipping a tenant's configured default from here would be the wrong default
   * in both directions.
   */
  callRecordingEnabled: boolean | null
}

export type ElevenLabsScope = {
  tenantId: string
  organizationId: string
}

/**
 * Reads one tenant's raw credential record. Structurally typed rather than
 * imported from the `integrations` module so this package still compiles where
 * that module is disabled — the `storage_s3` precedent.
 */
export type IntegrationCredentialsReader = {
  resolve(
    integrationId: string,
    scope: ElevenLabsScope,
  ): Promise<Record<string, unknown> | null>
}

export class ElevenLabsCredentialsError extends Error {
  readonly code = 'ELEVENLABS_CREDENTIALS_INVALID'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'ElevenLabsCredentialsError'
  }
}

function readRequiredString(
  raw: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = raw[key]
  if (typeof value !== 'string' || !value.trim()) {
    // The message names the FIELD, never the value: this error travels into the
    // agent run's failure reason, which is rendered in the cockpit.
    throw new ElevenLabsCredentialsError(
      `ElevenLabs integration is missing the required "${label}" credential for this tenant`,
    )
  }
  return value.trim()
}

function readOptionalString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function readTelephonyProvider(raw: Record<string, unknown>): ElevenLabsTelephonyProvider {
  const value = raw.telephonyProvider
  if (value === 'sip_trunk') return 'sip_trunk'
  // FALLBACK IS TWILIO, and it is safe by construction: the two endpoints are
  // distinct paths on the same API, so a wrong choice is a rejected request and
  // a failed run, never a call placed through the wrong carrier. Twilio is the
  // documented default wiring, and an unset or unrecognised value therefore
  // resolves to it rather than throwing — a tenant configured before this field
  // existed keeps working.
  return 'twilio'
}

function readOptionalBoolean(raw: Record<string, unknown>, key: string): boolean | null {
  const value = raw[key]
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

/** Parse a raw credential record into the typed shape, or throw naming the missing field. */
export function parseElevenLabsCredentials(raw: Record<string, unknown> | null): ElevenLabsCredentials {
  if (!raw) {
    throw new ElevenLabsCredentialsError(
      'ElevenLabs integration is not configured for this tenant',
    )
  }

  return {
    apiKey: readRequiredString(raw, 'apiKey', 'API key'),
    webhookSecret: readRequiredString(raw, 'webhookSecret', 'Webhook secret'),
    agentId: readRequiredString(raw, 'agentId', 'Agent ID'),
    agentPhoneNumberId: readRequiredString(raw, 'agentPhoneNumberId', 'Phone number ID'),
    telephonyProvider: readTelephonyProvider(raw),
    defaultCallerId: readOptionalString(raw, 'defaultCallerId'),
    callRecordingEnabled: readOptionalBoolean(raw, 'callRecordingEnabled'),
  }
}

/**
 * Strip this tenant's secrets out of provider-supplied text before it is
 * interpolated into an error message.
 *
 * Needed because ElevenLabs' own error bodies can echo request material back,
 * and the one field worth surfacing to an operator — `message` on a
 * `success: false` response — is exactly the field most likely to contain it.
 * The resulting string is persisted on the agent run and rendered in the
 * cockpit, so "the provider said it first" is not a licence to store it.
 *
 * Redaction is a backstop, not the primary control: the primary control is that
 * nothing here interpolates a credential in the first place.
 */
export function redactSecrets(text: string, credentials: Pick<ElevenLabsCredentials, 'apiKey' | 'webhookSecret'>): string {
  let redacted = text
  for (const secret of [credentials.apiKey, credentials.webhookSecret]) {
    // A very short configured value would turn redaction into mangling; a real
    // ElevenLabs key or webhook secret is far longer than this floor.
    if (secret && secret.length >= 8) redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted
}

/**
 * The only credential-derived thing that may reach a log line: presence flags
 * and the non-secret provider ids.
 */
export function describeCredentialsForLog(credentials: ElevenLabsCredentials): Record<string, unknown> {
  return {
    agentId: credentials.agentId,
    agentPhoneNumberId: credentials.agentPhoneNumberId,
    telephonyProvider: credentials.telephonyProvider,
    hasApiKey: Boolean(credentials.apiKey),
    hasWebhookSecret: Boolean(credentials.webhookSecret),
  }
}
