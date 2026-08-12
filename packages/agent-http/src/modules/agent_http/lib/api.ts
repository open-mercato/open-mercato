/**
 * The one outbound request this package makes, and the SSRF guard around it.
 *
 * ─── WHY SSRF MATTERS HERE AND DID NOT FOR THE VOICE CONNECTOR ───────────────
 *
 * `agent_elevenlabs` posts to a constant, `https://api.elevenlabs.io`. This
 * connector posts to whatever the TENANT configured, which makes the target a
 * data-controlled URL reachable from inside the deployment's network — the exact
 * shape `CALL_WEBHOOK` is guarded against. So every request goes through the
 * platform's shared guard (`@open-mercato/shared/lib/url-safety`), which is the
 * same code path `CALL_WEBHOOK` uses rather than a second, weaker copy:
 *
 *   - protocol must be http/https, no `file:`, `gopher:` or anything else;
 *   - no basic-auth credentials embedded in the URL;
 *   - blocked hostnames (`localhost`, `*.internal`, the cloud metadata names) are
 *     refused;
 *   - an IP literal in a private or reserved range is refused;
 *   - a hostname is RESOLVED and every answer is checked, then the connection is
 *     PINNED to the validated address, so DNS cannot rebind between the check and
 *     the connect;
 *   - `redirect: 'manual'`, and a 3xx is refused rather than followed — following
 *     it would re-enter an unvalidated URL.
 *
 * The escape hatch mirrors `CALL_WEBHOOK`'s exactly, including that it is IGNORED
 * in production: a developer pointing the connector at a local stub is normal, a
 * deployment doing it is not.
 *
 * Nothing in this file logs, and no thrown message ever contains a credential or a
 * provider response body — the caller decides what is worth surfacing.
 */

import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  safeOutboundFetch,
  UnsafeOutboundUrlError,
  type HostLookup,
} from '@open-mercato/shared/lib/url-safety'

const logger = createLogger('agent_http').child({ component: 'outbound' })

export const ALLOW_PRIVATE_URLS_ENV = 'OM_AGENT_HTTP_ALLOW_PRIVATE_URLS'

/**
 * The start response is parsed only to find the provider's run id, so it needs no
 * room for a payload. The cap bounds what one misconfigured target can make this
 * process buffer.
 */
export const MAX_START_RESPONSE_BYTES = 64 * 1024

export type GenericHttpFetch = typeof fetch

/**
 * `bodyHint` carries a TRUNCATED copy of the provider's response text, and the
 * error's own `message` never contains it. That split is deliberate: a provider's
 * error body is worth showing an operator and can echo the request's own auth
 * header back, so the only place it may be interpolated is a call site that holds
 * the credentials and can redact them (`connector.ts`). Anything that catches this
 * error and prints `error.message` is safe by construction.
 */
export class GenericHttpApiError extends Error {
  readonly code = 'AGENT_HTTP_REQUEST_FAILED'
  readonly status: number | null
  readonly bodyHint: string | null
  constructor(message: string, status: number | null, bodyHint: string | null = null) {
    super(`[internal] ${message}`)
    this.name = 'GenericHttpApiError'
    this.status = status
    this.bodyHint = bodyHint
  }
}

/** How much of a provider error body is worth carrying into an operator-facing hint. */
export const MAX_BODY_HINT_CHARS = 200

export class GenericHttpUnsafeUrlError extends Error {
  readonly code = 'AGENT_HTTP_UNSAFE_URL'
  readonly reason: string
  constructor(message: string, reason: string) {
    super(`[internal] ${message}`)
    this.name = 'GenericHttpUnsafeUrlError'
    this.reason = reason
  }
}

export function isAllowPrivateUrlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!parseBooleanWithDefault(env[ALLOW_PRIVATE_URLS_ENV], false)) return false
  if (env.NODE_ENV === 'production') {
    logger.warn(
      `${ALLOW_PRIVATE_URLS_ENV} is set but ignored in production. SSRF protection remains enabled.`,
    )
    return false
  }
  logger.warn(
    `${ALLOW_PRIVATE_URLS_ENV} is enabled. SSRF protection is bypassed for HTTP agent start requests; use only in development.`,
  )
  return true
}

export type StartRequestArgs = {
  url: string
  headers: Record<string, string>
  body: unknown
  fetchImpl?: GenericHttpFetch
  lookupHost?: HostLookup
  allowPrivate?: boolean
}

export type StartResponse = {
  status: number
  payload: unknown
  /** The raw response text, capped. Only ever used to build a redacted operator hint. */
  text: string
}

/**
 * POST the start request and return the parsed body.
 *
 * It does NOT wait for the external run to finish — that is the whole point of the
 * suspend/resume seam, and a connector that polled here would pin a worker slot
 * for the length of the run.
 */
export async function postStartRequest(args: StartRequestArgs): Promise<StartResponse> {
  let response: Response
  try {
    response = await safeOutboundFetch(
      args.url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...args.headers },
        body: JSON.stringify(args.body ?? {}),
        redirect: 'manual',
      },
      {
        subject: 'HTTP agent start URL',
        allowPrivate: args.allowPrivate ?? isAllowPrivateUrlsEnabled(),
        lookupHost: args.lookupHost,
        fetchImpl: args.fetchImpl,
      },
    )
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) {
      // The guard's message names the host and the reason and never the body, so
      // it is safe to surface — and it is exactly what an operator needs to fix
      // the credential.
      throw new GenericHttpUnsafeUrlError(
        `HTTP agent start URL was refused by the outbound URL guard (reason=${error.reason}): ${error.message}`,
        error.reason,
      )
    }
    throw error
  }

  if (response.status >= 300 && response.status < 400) {
    // Following it would re-enter a URL nothing validated. The `Location` value is
    // provider-supplied and is NOT echoed, for the same reason the body is not.
    throw new GenericHttpApiError(
      `HTTP agent start URL answered with a ${response.status} redirect, which is refused rather than followed`,
      response.status,
    )
  }

  const text = await readCappedText(response)

  if (!response.ok) {
    throw new GenericHttpApiError(
      `the configured HTTP agent endpoint rejected the start request with HTTP ${response.status}`,
      response.status,
      text.slice(0, MAX_BODY_HINT_CHARS).trim() || null,
    )
  }

  return { status: response.status, payload: parseJson(text), text }
}

async function readCappedText(response: Response): Promise<string> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > MAX_START_RESPONSE_BYTES) {
    throw new GenericHttpApiError(
      `the configured HTTP agent endpoint answered with a body larger than ${MAX_START_RESPONSE_BYTES} bytes`,
      response.status,
    )
  }
  const text = await response.text()
  if (text.length > MAX_START_RESPONSE_BYTES) {
    throw new GenericHttpApiError(
      `the configured HTTP agent endpoint answered with a body larger than ${MAX_START_RESPONSE_BYTES} bytes`,
      response.status,
    )
  }
  return text
}

function parseJson(text: string): unknown {
  if (!text.trim().length) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
