/**
 * Thin Entra ID (Microsoft identity platform) OAuth client wrapper. Uses raw
 * `fetch` against the documented v2.0 endpoints so the adapter carries no MSAL
 * dependency and tests can stub `setMicrosoftOAuthClient(...)`.
 *
 * Endpoints (authority = `https://login.microsoftonline.com/{tenant}/oauth2/v2.0`):
 *   - Authorize  {authority}/authorize
 *   - Token      {authority}/token
 *   - Profile    https://graph.microsoft.com/v1.0/me  (identity lookup after consent)
 *
 * The `{tenant}` segment comes from the tenant client config (`organizations`
 * by default — see `credentials.ts`). Refreshes use the user's home directory
 * (`tid` claim) captured at exchange time so they keep working regardless of
 * the alias the admin configured.
 */

import { createHash, randomBytes } from 'node:crypto'
import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import {
  requestOAuthToken,
  tokenResponseToExpiresAt,
  type OAuthTokenResponse,
} from '@open-mercato/core/modules/communication_channels/lib/oauth-token'
import { parseScopes } from './credentials'

export { tokenResponseToExpiresAt }

export const MS365_DEFAULT_LOGIN_BASE_URL = 'https://login.microsoftonline.com'
export const MS365_DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Sovereign-cloud override for the login authority (e.g. `login.microsoftonline.us`).
 * Only absolute `https://` URLs are honoured; anything else falls back to the
 * public cloud default so a typo cannot redirect consent to an unexpected host.
 */
export function resolveLoginBaseUrl(): string {
  const raw = process.env.OM_CHANNEL_MS365_LOGIN_BASE_URL?.trim()
  if (raw && /^https:\/\/[^/\s]+$/i.test(stripTrailingSlash(raw))) return stripTrailingSlash(raw)
  return MS365_DEFAULT_LOGIN_BASE_URL
}

/** Sovereign-cloud override for the Graph base URL (e.g. `https://graph.microsoft.us/v1.0`). */
export function resolveGraphBaseUrl(): string {
  const raw = process.env.OM_CHANNEL_MS365_GRAPH_BASE_URL?.trim()
  if (raw && /^https:\/\/[^\s]+$/i.test(raw)) return stripTrailingSlash(raw)
  return MS365_DEFAULT_GRAPH_BASE_URL
}

export function buildAuthorityUrl(tenantId: string): string {
  return `${resolveLoginBaseUrl()}/${encodeURIComponent(tenantId)}/oauth2/v2.0`
}

export function buildAuthorizeEndpoint(tenantId: string): string {
  return `${buildAuthorityUrl(tenantId)}/authorize`
}

export function buildTokenEndpoint(tenantId: string): string {
  return `${buildAuthorityUrl(tenantId)}/token`
}

// ── PKCE ─────────────────────────────────────────────────────

export interface PkcePair {
  /** 43–128 char unreserved string (RFC 7636 §4.1). */
  verifier: string
  /** `BASE64URL(SHA256(verifier))` — the S256 challenge. */
  challenge: string
}

export function derivePkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: derivePkceChallenge(verifier) }
}

// ── Client contract ──────────────────────────────────────────

export interface BuildAuthorizeUrlInput {
  clientId: string
  tenantId: string
  redirectUri: string
  state: string
  scopes: string[]
  codeChallenge: string
  loginHint?: string
}

export interface ExchangeCodeInput {
  clientId: string
  clientSecret: string
  tenantId: string
  redirectUri: string
  code: string
  codeVerifier: string
  scopes: string[]
}

export interface RefreshTokenInput {
  clientId: string
  clientSecret: string
  tenantId: string
  refreshToken: string
  scopes: string[]
}

export type TokenResponse = OAuthTokenResponse

/** Subset of the Graph `user` resource returned by `GET /me`. */
export interface MicrosoftProfile {
  id?: string
  mail?: string | null
  userPrincipalName?: string
  displayName?: string | null
}

export interface MicrosoftOAuthClient {
  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string
  exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse>
  refreshToken(input: RefreshTokenInput): Promise<TokenResponse>
  fetchProfile(accessToken: string): Promise<MicrosoftProfile>
}

class RealMicrosoftOAuthClient implements MicrosoftOAuthClient {
  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    const url = new URL(buildAuthorizeEndpoint(input.tenantId))
    url.searchParams.set('client_id', input.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('scope', (input.scopes.length ? input.scopes : parseScopes(undefined)).join(' '))
    url.searchParams.set('state', input.state)
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    // `select_account` lets a user with several Microsoft sessions pick the
    // mailbox to connect without forcing a full re-consent every time.
    url.searchParams.set('prompt', 'select_account')
    if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
    return url.toString()
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse> {
    const params = new URLSearchParams()
    params.set('grant_type', 'authorization_code')
    params.set('code', input.code)
    params.set('redirect_uri', input.redirectUri)
    params.set('client_id', input.clientId)
    params.set('client_secret', input.clientSecret)
    params.set('code_verifier', input.codeVerifier)
    params.set('scope', input.scopes.join(' '))
    return requestOAuthToken(buildTokenEndpoint(input.tenantId), params, {
      errorLabel: 'Microsoft 365 OAuth code exchange failed',
    })
  }

  async refreshToken(input: RefreshTokenInput): Promise<TokenResponse> {
    const params = new URLSearchParams()
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', input.refreshToken)
    params.set('client_id', input.clientId)
    params.set('client_secret', input.clientSecret)
    params.set('scope', input.scopes.join(' '))
    return requestOAuthToken(buildTokenEndpoint(input.tenantId), params, {
      errorLabel: 'Microsoft 365 OAuth refresh failed',
    })
  }

  async fetchProfile(accessToken: string): Promise<MicrosoftProfile> {
    const url = new URL(`${resolveGraphBaseUrl()}/me`)
    url.searchParams.set('$select', 'id,mail,userPrincipalName,displayName')
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: 10_000,
    })
    if (!res.ok) {
      throw new Error(`Microsoft Graph profile fetch failed: ${res.status} ${res.statusText}`)
    }
    return (await res.json()) as MicrosoftProfile
  }
}

let cachedClient: MicrosoftOAuthClient | null = null

export function getMicrosoftOAuthClient(): MicrosoftOAuthClient {
  if (!cachedClient) cachedClient = new RealMicrosoftOAuthClient()
  return cachedClient
}

export function setMicrosoftOAuthClient(client: MicrosoftOAuthClient | null): void {
  cachedClient = client
}

// ── id_token claims (unverified) ─────────────────────────────

export interface IdTokenClaims {
  preferred_username?: string
  email?: string
  name?: string
  /** Home directory (tenant) id of the signed-in user. */
  tid?: string
  oid?: string
}

/**
 * Decode the payload of an `id_token` WITHOUT verifying its signature. The
 * token arrives over the TLS-protected token endpoint response in exchange
 * for a code the hub's signed state cookie already bound to the initiating
 * user, and the claims only seed a display value / the refresh authority —
 * never authorization. Returns `null` on any shape problem.
 */
export function decodeIdTokenClaims(idToken: string | undefined): IdTokenClaims | null {
  if (!idToken) return null
  const segments = idToken.split('.')
  if (segments.length < 2) return null
  try {
    const payload = Buffer.from(segments[1], 'base64url').toString('utf-8')
    const parsed = JSON.parse(payload) as Record<string, unknown>
    const pick = (key: string): string | undefined =>
      typeof parsed[key] === 'string' && (parsed[key] as string).length > 0 ? (parsed[key] as string) : undefined
    return {
      preferred_username: pick('preferred_username'),
      email: pick('email'),
      name: pick('name'),
      tid: pick('tid'),
      oid: pick('oid'),
    }
  } catch {
    return null
  }
}
