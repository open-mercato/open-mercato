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
 * ─── WHY PROFILES ARE ONE JSON-BEARING `text` FIELD ──────────────────────────
 *
 * A tenant runs SEVERAL voice agents — the owner call, the satisfaction survey,
 * the payment chase — each with its own ElevenLabs agent id and often its own
 * number. The obvious modelling is a repeating credential field, and the
 * integrations credential store cannot express one:
 *
 *   - the DB column IS jsonb (`integration_credentials.credentials`, typed
 *     `Record<string, unknown>`), so the STORAGE is not the constraint;
 *   - but the admin write path is, twice over. `saveCredentialsSchema`
 *     (`integrations/data/validators.ts`) types every credential VALUE as
 *     `string | number | boolean | null` — an array or an object is a 422 — and
 *     `CredentialFieldType` has no list, group or json member, so the admin form
 *     can only render flat scalar inputs.
 *
 * So a nested `profiles: [...]` value could never be saved through the UI or the
 * API, whatever this package declared. The two honest options were N numbered
 * slots (a fixed ceiling and seven form fields per profile) or ONE `text` field
 * holding a JSON document. This file takes the second: a single `profiles`
 * credential whose string value is parsed here, which keeps the profile list
 * variable-length and keeps every profile's fields together.
 *
 * CONSEQUENCE WORTH KNOWING: a `text` field is NOT masked on read-back
 * (`maskSecretCredentials` masks `secret`/`oauth`/`ssh_keypair` only), so a
 * profile must never carry a secret. It carries provider ids and a caller id —
 * configuration, not credentials — and the parser rejects any key it does not
 * know so a secret pasted in there cannot silently ride along.
 *
 * SECRET HANDLING: `apiKey` and `webhookSecret` are `type: 'secret'` fields
 * (see `integration.ts`), encrypted at rest by the credential store. Nothing in
 * this package ever puts either value into a log line, an error message or an
 * event payload — `describeCredentialsForLog` is the only thing allowed near a
 * logger, and it emits presence booleans and non-secret ids only.
 */

import { z } from 'zod'

/** Which ElevenLabs outbound-call endpoint this tenant's number is wired to. */
export type ElevenLabsTelephonyProvider = 'twilio' | 'sip_trunk'

/**
 * The credential key holding the JSON profile document, and the name of the
 * profile an agent that declares none falls back to.
 */
export const PROFILES_CREDENTIAL_KEY = 'profiles'
export const DEFAULT_PROFILE_NAME = 'default'

/**
 * One named way to place a call: which ElevenLabs agent, from which number, over
 * which wiring.
 *
 * This is the unit a workflow node used to have to spell out. Naming it here
 * means the workflow definition names a PROFILE and the tenant owns the provider
 * ids, so rotating an ElevenLabs agent is a credential edit rather than an edit
 * of every definition that dials it.
 */
export type ElevenLabsCallProfile = {
  /** Unique within the tenant. `default` is the fallback every agent gets. */
  name: string
  agentId: string
  phoneNumberId: string
  telephonyProvider: ElevenLabsTelephonyProvider
  /**
   * Optional caller id presented to the callee, passed through as
   * `telephony_call_config.caller_id` when set. Purely a default: the workflow
   * never chooses it, because "who is calling" is a tenant-level compliance
   * decision, not a per-run one.
   */
  defaultCallerId: string | null
  /**
   * Per-profile `call_recording_enabled`. `null` means "say nothing and let the
   * ElevenLabs agent's own setting stand" — deliberately distinct from `false`,
   * because recording consent is regulated (design R6) and silently flipping a
   * tenant's configured default from here would be the wrong default in both
   * directions.
   */
  callRecordingEnabled: boolean | null
}

export type ElevenLabsCredentials = {
  apiKey: string
  webhookSecret: string
  /**
   * Named profiles, keyed by name. Never empty: a record with neither a profile
   * document nor the legacy flat pair fails the parse, so a tenant can never
   * reach `start()` with nothing to dial with.
   */
  profiles: Record<string, ElevenLabsCallProfile>
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

/**
 * Raised when an agent names a profile the tenant has not configured, or names
 * none and the tenant has no `default`.
 *
 * Its own class because it is the FAIL-CLOSED arm and the runner turns it into a
 * failed run before a single byte reaches ElevenLabs. Falling back to `default`
 * instead would place a REAL phone call from the wrong agent, with the wrong
 * script and possibly the wrong caller id — strictly worse than not calling.
 */
export class ElevenLabsProfileNotConfiguredError extends Error {
  readonly code = 'ELEVENLABS_PROFILE_NOT_CONFIGURED'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'ElevenLabsProfileNotConfiguredError'
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

function readTelephonyProvider(value: unknown): ElevenLabsTelephonyProvider {
  if (value === 'sip_trunk') return 'sip_trunk'
  // FALLBACK IS TWILIO, and it is safe by construction: the two endpoints are
  // distinct paths on the same API, so a wrong choice is a rejected request and
  // a failed run, never a call placed through the wrong carrier. Twilio is the
  // documented default wiring, and an unset or unrecognised value therefore
  // resolves to it rather than throwing — a tenant configured before this field
  // existed keeps working.
  return 'twilio'
}

function readOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

/**
 * The authored shape of one profile inside the JSON document.
 *
 * `.strict()` is deliberate: an operator who mistypes `phone_number_id` gets a
 * parse error naming the key instead of a profile that silently dials the
 * default number, and a secret pasted into an unknown key cannot ride along in
 * an unmasked field.
 */
const authoredProfileSchema = z.object({
  name: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  telephonyProvider: z.enum(['twilio', 'sip_trunk']).optional(),
  defaultCallerId: z.string().trim().min(1).nullish(),
  callRecordingEnabled: z.boolean().nullish(),
}).strict()

/**
 * Both authoring forms are accepted, because an operator typing JSON by hand
 * will reach for either and neither is wrong:
 *
 *   [{ "name": "survey", "agentId": "…", "phoneNumberId": "…" }]
 *   { "survey": { "agentId": "…", "phoneNumberId": "…" } }
 */
const authoredProfilesSchema = z.union([
  z.array(authoredProfileSchema),
  z.record(z.string().trim().min(1), authoredProfileSchema),
])

function toProfile(name: string, authored: z.infer<typeof authoredProfileSchema>): ElevenLabsCallProfile {
  return {
    name,
    agentId: authored.agentId.trim(),
    phoneNumberId: authored.phoneNumberId.trim(),
    telephonyProvider: readTelephonyProvider(authored.telephonyProvider),
    defaultCallerId: authored.defaultCallerId?.trim() || null,
    callRecordingEnabled: readOptionalBoolean(authored.callRecordingEnabled),
  }
}

/**
 * Parse the `profiles` credential.
 *
 * The stored value is a STRING because that is all the credential write path
 * accepts (see the file header), but an object/array is accepted too so a
 * preset or a test that writes the structure directly through the service is not
 * a special case.
 */
function parseProfilesDocument(value: unknown): Record<string, ElevenLabsCallProfile> {
  if (value === undefined || value === null) return {}
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return {}
    let decoded: unknown
    try {
      decoded = JSON.parse(trimmed)
    } catch {
      // The parser's own message can quote the input, which is why it is not
      // interpolated: this string is persisted on the run and shown in the cockpit.
      throw new ElevenLabsCredentialsError(
        `The ElevenLabs "Call Profiles" credential is not valid JSON. Expected a list like [{"name":"survey","agentId":"…","phoneNumberId":"…"}].`,
      )
    }
    return parseProfilesDocument(decoded)
  }

  const parsed = authoredProfilesSchema.safeParse(value)
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean))]
    throw new ElevenLabsCredentialsError(
      `The ElevenLabs "Call Profiles" credential is malformed${keys.length ? ` at ${keys.join(', ')}` : ''}. Every profile needs a name, an agentId and a phoneNumberId.`,
    )
  }

  const entries = Array.isArray(parsed.data)
    ? parsed.data.map((authored, index) => {
      const name = authored.name?.trim()
      if (!name) {
        throw new ElevenLabsCredentialsError(
          `The ElevenLabs "Call Profiles" credential has a profile at position ${index + 1} with no "name".`,
        )
      }
      return [name, authored] as const
    })
    : Object.entries(parsed.data).map(([key, authored]) => [key.trim(), authored] as const)

  const profiles: Record<string, ElevenLabsCallProfile> = {}
  for (const [name, authored] of entries) {
    if (profiles[name]) {
      throw new ElevenLabsCredentialsError(
        `The ElevenLabs "Call Profiles" credential declares the profile "${name}" twice.`,
      )
    }
    profiles[name] = toProfile(name, authored)
  }
  return profiles
}

/**
 * The MIGRATION GUARANTEE, in one function.
 *
 * Every tenant configured before profiles existed holds the flat `agentId` /
 * `agentPhoneNumberId` pair and nothing else. Read as the `default` profile they
 * keep dialling exactly as before, with no operator action, and an agent that
 * names no profile resolves to it.
 *
 * Returns `null` when the flat pair is absent, which is the legitimate state of
 * a tenant that configured profiles only.
 */
function readLegacyDefaultProfile(raw: Record<string, unknown>): ElevenLabsCallProfile | null {
  const agentId = readOptionalString(raw, 'agentId')
  const phoneNumberId = readOptionalString(raw, 'agentPhoneNumberId')
  if (!agentId || !phoneNumberId) return null
  return {
    name: DEFAULT_PROFILE_NAME,
    agentId,
    phoneNumberId,
    telephonyProvider: readTelephonyProvider(raw.telephonyProvider),
    defaultCallerId: readOptionalString(raw, 'defaultCallerId'),
    callRecordingEnabled: readOptionalBoolean(raw.callRecordingEnabled),
  }
}

/** Parse a raw credential record into the typed shape, or throw naming the missing field. */
export function parseElevenLabsCredentials(raw: Record<string, unknown> | null): ElevenLabsCredentials {
  if (!raw) {
    throw new ElevenLabsCredentialsError(
      'ElevenLabs integration is not configured for this tenant',
    )
  }

  const profiles = parseProfilesDocument(raw[PROFILES_CREDENTIAL_KEY])
  const legacyDefault = readLegacyDefaultProfile(raw)
  // An EXPLICIT `default` in the document wins over the flat pair: it is the more
  // deliberate configuration, and an operator who wrote one meant it. Otherwise
  // the flat pair fills the slot, which is what keeps an already-configured
  // tenant working when it starts adding named profiles beside it.
  if (!profiles[DEFAULT_PROFILE_NAME] && legacyDefault) {
    profiles[DEFAULT_PROFILE_NAME] = legacyDefault
  }

  if (!Object.keys(profiles).length) {
    throw new ElevenLabsCredentialsError(
      'ElevenLabs integration has no call profile configured for this tenant: set "Agent ID" and "Phone Number ID", or add a profile under "Call Profiles"',
    )
  }

  return {
    apiKey: readRequiredString(raw, 'apiKey', 'API key'),
    webhookSecret: readRequiredString(raw, 'webhookSecret', 'Webhook secret'),
    profiles,
  }
}

/**
 * Which profile this run dials with — the whole precedence, in one place.
 *
 *   1. the agent's declared `profile` (`defineExternalAgent({ profile })`)
 *   2. otherwise `default`
 *
 * The PER-CALL `input.agentId` / `input.agentPhoneNumberId` overrides sit one
 * layer above this, applied by the connector to whatever this returns — so the
 * full order the connector implements is
 * per-call override > named profile > `default`.
 *
 * FAILS CLOSED. A named profile that is not configured throws instead of falling
 * back to `default`, because the fallback would place a real phone call from the
 * wrong ElevenLabs agent — a different script, to a real person, on the tenant's
 * bill. "Nothing happened, here is what to configure" is the only safe answer.
 */
export function resolveCallProfile(
  credentials: ElevenLabsCredentials,
  args: { profileName?: string | null; agentId: string },
): ElevenLabsCallProfile {
  const requested = args.profileName?.trim()
  const name = requested && requested.length ? requested : DEFAULT_PROFILE_NAME
  const profile = credentials.profiles[name]
  if (profile) return profile

  const configured = Object.keys(credentials.profiles).sort()
  const available = configured.length ? configured.join(', ') : '(none)'
  if (requested && requested.length) {
    throw new ElevenLabsProfileNotConfiguredError(
      `external agent "${args.agentId}" requires the ElevenLabs call profile "${name}", which this tenant has not configured. Configured profiles: ${available}. Add it under Integrations -> ElevenLabs Conversational AI -> Call Profiles.`,
    )
  }
  throw new ElevenLabsProfileNotConfiguredError(
    `external agent "${args.agentId}" declares no call profile, so it needs the "${DEFAULT_PROFILE_NAME}" ElevenLabs profile, which this tenant has not configured. Configured profiles: ${available}. Set "Agent ID" and "Phone Number ID", or add a "${DEFAULT_PROFILE_NAME}" entry under Call Profiles.`,
  )
}

/**
 * Profile names as configured, for a health report. Never throws: the health
 * check is handed the RAW record and must answer even when it is malformed.
 */
export function listConfiguredProfileNames(raw: Record<string, unknown> | null): string[] {
  if (!raw) return []
  let profiles: Record<string, ElevenLabsCallProfile> = {}
  try {
    profiles = parseProfilesDocument(raw[PROFILES_CREDENTIAL_KEY])
  } catch {
    profiles = {}
  }
  const names = new Set(Object.keys(profiles))
  if (readLegacyDefaultProfile(raw)) names.add(DEFAULT_PROFILE_NAME)
  return [...names].sort()
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
 * and the non-secret provider ids of the profile actually used.
 *
 * The provider ids are prefixed `profile*` rather than named `agentId` /
 * `agentPhoneNumberId`, because the caller's log record already carries `agentId`
 * meaning the OPEN MERCATO agent (`voice.owner_call`). Spreading this map used to
 * silently overwrite it, so every "placed a call" line reported the ElevenLabs
 * agent under a key everything else in the platform reads as ours.
 */
export function describeCredentialsForLog(
  credentials: ElevenLabsCredentials,
  profile: ElevenLabsCallProfile,
): Record<string, unknown> {
  return {
    profile: profile.name,
    profileAgentId: profile.agentId,
    profilePhoneNumberId: profile.phoneNumberId,
    telephonyProvider: profile.telephonyProvider,
    hasApiKey: Boolean(credentials.apiKey),
    hasWebhookSecret: Boolean(credentials.webhookSecret),
  }
}
