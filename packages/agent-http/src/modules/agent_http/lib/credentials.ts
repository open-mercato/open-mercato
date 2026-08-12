/**
 * The tenant's generic-HTTP endpoint configuration, as stored in the
 * `integrations` credential store and as the connector consumes it.
 *
 * Nothing here touches the database or the container: it is the pure shape +
 * parse half, so the connector can be unit-tested with a fake reader. The
 * DB-backed reader lives in `credentialsReader.ts` and is wired from `di.ts`.
 *
 * ─── WHY EVERY KNOB IS PER TENANT, AND NONE IS PER AGENT ─────────────────────
 *
 * This connector is configured entirely from these fields — there is no provider
 * SDK and no fixed payload shape to hard-code. The natural next wish is to make
 * the configuration per AGENT (one agent talks to the research service, another
 * to the approvals service), and the seam cannot express it:
 *
 *   verifyCallback(headers, rawBody, scope)   // tenancy only
 *   normalize(rawPayload, context?)           // tenancy only
 *
 * A callback is addressed by RUN — a single-use token, or the provider's own run
 * id — and by the time either of these runs, the only identity the platform has
 * established is the tenant's. The agent is known to the correlation ROW, not to
 * the connector. So the signing secret, the signature scheme and the result path
 * are necessarily one set per (tenant, connector), and an agent that asked for a
 * second set would have to be served by a second registered connector.
 *
 * That is why `start()` FAILS CLOSED on `defineExternalAgent({ profile })` rather
 * than honouring it: the start half could vary per profile, but the callback half
 * could not, so a "profile" here would silently mean "a different endpoint whose
 * answer is read as though it came from the first one".
 *
 * ─── SECRET HANDLING ─────────────────────────────────────────────────────────
 *
 * `authHeaderValue` and `signingSecret` are `type: 'secret'` fields (see
 * `integration.ts`): masked in the admin UI and redacted out of the read-back
 * API. Nothing in this package puts either value into a log line, an error
 * message or an event payload — `describeCredentialsForLog` is the only thing
 * allowed near a logger, and `redactSecrets` is the backstop for the one place a
 * provider's own text is surfaced.
 */

import { z } from 'zod'

export type GenericHttpSignatureScheme = 'hex' | 'sha256_prefix'

export const SIGNATURE_SCHEMES: readonly GenericHttpSignatureScheme[] = ['hex', 'sha256_prefix']

export const DEFAULT_AUTH_HEADER_NAME = 'Authorization'
export const DEFAULT_SIGNATURE_HEADER = 'x-om-signature'
export const DEFAULT_SIGNATURE_SCHEME: GenericHttpSignatureScheme = 'hex'
export const DEFAULT_RESULT_PATH = 'result.answer'
export const DEFAULT_EXTERNAL_RUN_ID_PATH = 'id'

/**
 * The body posted when a tenant configures no template of its own.
 *
 * It is deliberately the SHAPE the callback contract implies rather than a bare
 * echo of the input: a provider reading this needs the brief, and it needs
 * somewhere to post the answer.
 */
export const DEFAULT_REQUEST_TEMPLATE: unknown = {
  input: '{{input}}',
  callbackUrl: '{{callbackUrl}}',
  callbackToken: '{{callbackToken}}',
}

export const REQUEST_TEMPLATE_CREDENTIAL_KEY = 'requestTemplate'

export type GenericHttpCredentials = {
  /** Absolute https/http URL the run is started at. Always operator-configured, never workflow-supplied. */
  startUrl: string
  /** Header the auth value travels in. Ignored when no value is configured. */
  authHeaderName: string
  /** Secret. `null` for a provider that authenticates by IP or by the callback token alone. */
  authHeaderValue: string | null
  /** Secret. Required: an unsigned callback would let anyone settle this tenant's runs. */
  signingSecret: string
  /** Header the provider presents its HMAC in. */
  signatureHeader: string
  signatureScheme: GenericHttpSignatureScheme
  /** Dot/index path to the answer inside the provider's callback payload. */
  resultPath: string
  /** Dot/index path to the provider's own run id inside its START response. */
  externalRunIdPath: string
  /** Parsed JSON template for the POST body. */
  requestTemplate: unknown
}

export type GenericHttpScope = {
  tenantId: string
  organizationId: string
}

/**
 * Reads one tenant's raw credential record. Structurally typed rather than
 * imported from the `integrations` module so this package still compiles where
 * that module is disabled — the `storage_s3` / `agent_elevenlabs` precedent.
 */
export type IntegrationCredentialsReader = {
  resolve(
    integrationId: string,
    scope: GenericHttpScope,
  ): Promise<Record<string, unknown> | null>
}

export class GenericHttpCredentialsError extends Error {
  readonly code = 'AGENT_HTTP_CREDENTIALS_INVALID'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'GenericHttpCredentialsError'
  }
}

function readOptionalString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function readRequiredString(raw: Record<string, unknown>, key: string, label: string): string {
  const value = readOptionalString(raw, key)
  if (!value) {
    // The message names the FIELD, never the value: this error travels into the
    // agent run's failure reason, which is rendered in the cockpit.
    throw new GenericHttpCredentialsError(
      `HTTP agent integration is missing the required "${label}" credential for this tenant`,
    )
  }
  return value
}

function readSignatureScheme(value: unknown): GenericHttpSignatureScheme {
  if (value === undefined || value === null || value === '') return DEFAULT_SIGNATURE_SCHEME
  if (value === 'hex' || value === 'sha256_prefix') return value
  // Unlike a telephony endpoint, a wrong scheme here does not fail loudly at the
  // provider — it silently rejects every callback, and the run parks until the
  // deadline sweep. So an unrecognised value is refused rather than defaulted.
  throw new GenericHttpCredentialsError(
    `HTTP agent integration has an unsupported "Signature Scheme" credential. Expected one of: ${SIGNATURE_SCHEMES.join(', ')}.`,
  )
}

/**
 * A path is `a.b.0.c`: dot-separated segments, numeric segments indexing arrays.
 * Prototype keys are refused outright — a read through `__proto__` cannot produce
 * a useful answer and can only produce a confusing one.
 */
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function assertUsablePath(path: string, label: string): string {
  const trimmed = path.trim()
  if (!trimmed.length) {
    throw new GenericHttpCredentialsError(
      `HTTP agent integration has an empty "${label}" credential; it must be a dot path such as "result.answer".`,
    )
  }
  const segments = trimmed.split('.')
  for (const segment of segments) {
    if (!segment.length) {
      throw new GenericHttpCredentialsError(
        `HTTP agent integration has a malformed "${label}" credential; a dot path may not contain an empty segment.`,
      )
    }
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw new GenericHttpCredentialsError(
        `HTTP agent integration has a "${label}" credential naming the reserved segment "${segment}".`,
      )
    }
  }
  return trimmed
}

/**
 * The POST body template.
 *
 * Stored as a STRING because that is all the credential write path accepts
 * (`saveCredentialsSchema` types every credential value as
 * `string | number | boolean | null`), but an already-structured value is
 * accepted too so a preset or a test writing through the service directly is not
 * a special case — the same shape `agent_elevenlabs` settled on for its profile
 * document, for the same reason.
 */
function parseRequestTemplate(value: unknown): unknown {
  if (value === undefined || value === null) return DEFAULT_REQUEST_TEMPLATE
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return DEFAULT_REQUEST_TEMPLATE
    let decoded: unknown
    try {
      decoded = JSON.parse(trimmed)
    } catch {
      // The parser's own message quotes the input, which is why it is not
      // interpolated: this string is persisted on the run and shown in the cockpit.
      throw new GenericHttpCredentialsError(
        'The HTTP agent "Request Body Template" credential is not valid JSON. Expected an object such as {"brief":"{{input.brief}}","callbackUrl":"{{callbackUrl}}"}.',
      )
    }
    return parseRequestTemplate(decoded)
  }
  const parsed = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).safeParse(value)
  if (!parsed.success) {
    throw new GenericHttpCredentialsError(
      'The HTTP agent "Request Body Template" credential must be a JSON object or array.',
    )
  }
  return parsed.data
}

/** Parse a raw credential record into the typed shape, or throw naming the missing field. */
export function parseGenericHttpCredentials(
  raw: Record<string, unknown> | null,
): GenericHttpCredentials {
  if (!raw) {
    throw new GenericHttpCredentialsError(
      'HTTP agent integration is not configured for this tenant',
    )
  }

  return {
    startUrl: readRequiredString(raw, 'startUrl', 'Start URL'),
    authHeaderName: readOptionalString(raw, 'authHeaderName') ?? DEFAULT_AUTH_HEADER_NAME,
    authHeaderValue: readOptionalString(raw, 'authHeaderValue'),
    // REQUIRED, deliberately. Without a signing secret the callback route's only
    // remaining proof is the single-use token, and any party that ever saw one —
    // a proxy log, the provider's own error report — could settle that run with a
    // payload of its choosing. An integration that cannot sign should not be
    // wired to an agent.
    signingSecret: readRequiredString(raw, 'signingSecret', 'Callback Signing Secret'),
    signatureHeader: readOptionalString(raw, 'signatureHeader') ?? DEFAULT_SIGNATURE_HEADER,
    signatureScheme: readSignatureScheme(raw.signatureScheme),
    resultPath: assertUsablePath(readOptionalString(raw, 'resultPath') ?? DEFAULT_RESULT_PATH, 'Result Path'),
    externalRunIdPath: assertUsablePath(
      readOptionalString(raw, 'externalRunIdPath') ?? DEFAULT_EXTERNAL_RUN_ID_PATH,
      'External Run Id Path',
    ),
    requestTemplate: parseRequestTemplate(raw[REQUEST_TEMPLATE_CREDENTIAL_KEY]),
  }
}

/**
 * Strip this tenant's secrets out of provider-supplied text before it is
 * interpolated into an error message.
 *
 * The sibling voice connector found a REAL leak of exactly this kind: a provider's
 * error `message` was interpolated verbatim into a thrown error, and a provider
 * error body can echo the request's own auth header back — into a string that is
 * then persisted on the run and rendered in the cockpit. Redaction is the
 * backstop; the primary control is that nothing here interpolates a credential in
 * the first place.
 */
export function redactSecrets(
  text: string,
  credentials: Pick<GenericHttpCredentials, 'authHeaderValue' | 'signingSecret'>,
): string {
  let redacted = text
  for (const secret of [credentials.authHeaderValue, credentials.signingSecret]) {
    // A very short configured value would turn redaction into mangling; a real
    // token or signing secret is far longer than this floor.
    if (secret && secret.length >= 8) redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted
}

/**
 * The only credential-derived thing that may reach a log line: presence flags and
 * non-secret configuration.
 */
export function describeCredentialsForLog(
  credentials: GenericHttpCredentials,
): Record<string, unknown> {
  return {
    startUrlHost: safeHost(credentials.startUrl),
    signatureScheme: credentials.signatureScheme,
    signatureHeader: credentials.signatureHeader,
    hasAuthHeader: Boolean(credentials.authHeaderValue),
    hasSigningSecret: Boolean(credentials.signingSecret),
  }
}

/**
 * The HOST of the configured start URL, never the full URL: a path or query can
 * carry a tenant identifier or an embedded key, and this value goes to a logger.
 */
function safeHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host
  } catch {
    return null
  }
}
