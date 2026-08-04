import type { CustomFetch } from 'openid-client'
import {
  parseOutboundUrl,
  safeOutboundFetch,
  UnsafeOutboundUrlError,
  type HostLookup,
  type UrlSafetyReason,
} from '@open-mercato/shared/lib/url-safety'

const OIDC_URL_SUBJECT = 'OIDC endpoint URL'
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024

export interface OidcFetchDeps {
  fetchImpl?: typeof fetch
  lookupHost?: HostLookup
  maxResponseBytes?: number
  privateOriginAllowlist?: ReadonlySet<string>
}

export class UnsafeOidcUrlError extends UnsafeOutboundUrlError {
  constructor(reason: UrlSafetyReason, message: string) {
    super(reason, message)
    this.name = 'UnsafeOidcUrlError'
  }
}

export class OidcResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`OIDC response exceeded the ${maxBytes}-byte limit`)
    this.name = 'OidcResponseTooLargeError'
  }
}

export function getPrivateOidcOriginAllowlist(
  rawValue = process.env.OM_SSO_OIDC_PRIVATE_ORIGIN_ALLOWLIST ?? '',
): ReadonlySet<string> {
  const origins = new Set<string>()
  for (const entry of rawValue.split(',')) {
    const candidate = entry.trim().replace(/\/$/, '')
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        candidate === url.origin
      ) {
        origins.add(url.origin)
      }
    } catch {
      // Invalid entries fail closed and are ignored.
    }
  }
  return origins
}

export function createOidcFetch(deps: OidcFetchDeps = {}): CustomFetch {
  const privateOriginAllowlist =
    deps.privateOriginAllowlist ?? getPrivateOidcOriginAllowlist()
  const maxResponseBytes = deps.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  return async (rawUrl, options) => {
    const { url } = parseOutboundUrl(rawUrl, {
      errorFactory: oidcUrlErrorFactory,
      subject: OIDC_URL_SUBJECT,
    })
    if (url.protocol !== 'https:') {
      throw oidcUrlErrorFactory(
        'forbidden_protocol',
        `${OIDC_URL_SUBJECT} must use HTTPS`,
      )
    }

    const allowPrivate = privateOriginAllowlist.has(url.origin)
    const response = await safeOutboundFetch(rawUrl, options as RequestInit, {
      allowPrivate,
      errorFactory: oidcUrlErrorFactory,
      fetchImpl: deps.fetchImpl,
      lookupHost: deps.lookupHost,
      pinAllowedPrivate: allowPrivate,
      subject: OIDC_URL_SUBJECT,
    })
    return readBoundedResponse(response, maxResponseBytes)
  }
}

function oidcUrlErrorFactory(reason: UrlSafetyReason, message: string): Error {
  return new UnsafeOidcUrlError(
    reason === 'blocked_hostname' ? 'private_ip_resolved' : reason,
    message,
  )
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Response> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel()
    throw new OidcResponseTooLargeError(maxBytes)
  }

  if (!response.body) return response

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      throw new OidcResponseTooLargeError(maxBytes)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}
