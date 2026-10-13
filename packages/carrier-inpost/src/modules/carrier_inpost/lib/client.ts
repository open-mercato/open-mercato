import { inpostErrors } from './errors'

// InPost ShipX API documentation:
// https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/18153476/API+ShipX+ENG+Documentation

const INPOST_DEFAULT_BASE_URL = 'https://api-shipx-pl.easypack24.net'

// The Points API lives on a completely separate host from the ShipX (shipments) API.
// Production: https://api.inpost.pl  — Sandbox: https://sandbox-api-gateway-pl.easypack24.net
const INPOST_DEFAULT_POINTS_BASE_URL = 'https://api.inpost.pl'

// Overrides exist for the sandbox only, and the bearer token is sent to whatever host is
// configured, so overrides are restricted to InPost's own hosts over HTTPS.
const INPOST_ALLOWED_HOSTS = new Set(['api.inpost.pl'])
const INPOST_ALLOWED_HOST_SUFFIXES = ['.easypack24.net']

const INPOST_REQUEST_TIMEOUT_MS = 30_000

export function isAllowedInpostBaseUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password || parsed.port) return false
  const host = parsed.hostname.toLowerCase()
  return INPOST_ALLOWED_HOSTS.has(host) || INPOST_ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

function resolveOverrideUrl(override: unknown, fallback: string): string {
  if (typeof override !== 'string' || override.trim().length === 0) return fallback
  const url = override.trim().replace(/\/$/, '')
  if (!isAllowedInpostBaseUrl(url)) {
    throw inpostErrors.disallowedApiHost(url)
  }
  return url
}

export function resolveBaseUrl(credentials: Record<string, unknown>): string {
  return resolveOverrideUrl(credentials.apiBaseUrl, INPOST_DEFAULT_BASE_URL)
}

export function resolvePointsBaseUrl(credentials: Record<string, unknown>): string {
  return resolveOverrideUrl(credentials.apiPointsBaseUrl, INPOST_DEFAULT_POINTS_BASE_URL)
}

export function resolveApiToken(credentials: Record<string, unknown>): string {
  const token = credentials.apiToken
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw inpostErrors.missingApiToken()
  }
  const stripped = token.trim().replace(/^Bearer\s*/i, '').trim()
  if (stripped.length === 0) {
    throw inpostErrors.missingApiToken()
  }
  return stripped
}

export function resolveOrganizationId(credentials: Record<string, unknown>): string {
  const orgId = credentials.organizationId
  if (typeof orgId !== 'string' || orgId.trim().length === 0) {
    throw inpostErrors.missingOrganizationId()
  }
  return orgId.trim()
}

export type InpostRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  body?: unknown
  query?: Record<string, string>
}

export async function inpostRequest<T>(
  credentials: Record<string, unknown>,
  path: string,
  options: InpostRequestOptions = {},
): Promise<T> {
  const baseUrl = resolveBaseUrl(credentials)
  const token = resolveApiToken(credentials)

  const url = new URL(`${baseUrl}${path}`)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(INPOST_REQUEST_TIMEOUT_MS),
    method: options.method ?? 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw inpostErrors.apiError(response.status, text)
  }

  if (response.status === 204) {
    return undefined as unknown as T
  }

  return response.json() as Promise<T>
}

/**
 * Makes a GET request to the InPost Points API (separate host from ShipX).
 * The Points API base URL is resolved via resolvePointsBaseUrl.
 */
export async function inpostPointsRequest<T>(
  credentials: Record<string, unknown>,
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  const baseUrl = resolvePointsBaseUrl(credentials)
  const token = resolveApiToken(credentials)

  const url = new URL(`${baseUrl}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(INPOST_REQUEST_TIMEOUT_MS),
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw inpostErrors.apiError(response.status, text)
  }

  return response.json() as Promise<T>
}

/**
 * Fetches a binary or text response from the InPost API (e.g. label download).
 * Returns the raw response body as an ArrayBuffer so the caller can convert it
 * to base64 or any other representation.
 */
export async function inpostRequestRaw(
  credentials: Record<string, unknown>,
  path: string,
  query?: Record<string, string>,
): Promise<ArrayBuffer> {
  const baseUrl = resolveBaseUrl(credentials)
  const token = resolveApiToken(credentials)

  const url = new URL(`${baseUrl}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(INPOST_REQUEST_TIMEOUT_MS),
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': '*/*',
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw inpostErrors.apiError(response.status, text)
  }

  return response.arrayBuffer()
}
