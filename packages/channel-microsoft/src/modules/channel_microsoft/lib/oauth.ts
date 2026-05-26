/**
 * Microsoft identity platform v2.0 OAuth + PKCE wrapper.
 *
 * Endpoints (per-tenant; `common` is the multi-tenant authority):
 *   - Authorize  https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize
 *   - Token      https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
 *
 * PKCE: we always use S256. The hub stores the verifier alongside the state
 * cookie (via `extra.codeVerifier`) and passes it back in `exchangeOAuthCode`.
 */

import crypto from 'node:crypto'
import { MICROSOFT_DEFAULT_SCOPES, resolveAuthority } from './credentials'

export const MICROSOFT_AUTHORITY_BASE = 'https://login.microsoftonline.com'
export const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export interface BuildAuthorizeUrlInput {
  clientId: string
  tenantId?: string
  redirectUri: string
  state: string
  scopes: string[]
  loginHint?: string
  codeChallenge: string
}

export interface ExchangeCodeInput {
  clientId: string
  tenantId?: string
  clientSecret?: string
  redirectUri: string
  code: string
  codeVerifier: string
}

export interface RefreshTokenInput {
  clientId: string
  tenantId?: string
  clientSecret?: string
  refreshToken: string
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}

export interface MicrosoftOAuthClient {
  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string
  exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse>
  refreshToken(input: RefreshTokenInput): Promise<TokenResponse>
}

class RealMicrosoftOAuthClient implements MicrosoftOAuthClient {
  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    const url = new URL(`${MICROSOFT_AUTHORITY_BASE}/${resolveAuthority(input.tenantId)}/oauth2/v2.0/authorize`)
    url.searchParams.set('client_id', input.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('scope', (input.scopes.length ? input.scopes : [...MICROSOFT_DEFAULT_SCOPES]).join(' '))
    url.searchParams.set('state', input.state)
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
    return url.toString()
  }

  async exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse> {
    return this.postTokenEndpoint(input.tenantId, this.buildExchangeForm(input))
  }

  async refreshToken(input: RefreshTokenInput): Promise<TokenResponse> {
    return this.postTokenEndpoint(input.tenantId, this.buildRefreshForm(input))
  }

  private buildExchangeForm(input: ExchangeCodeInput): URLSearchParams {
    const params = new URLSearchParams()
    params.set('grant_type', 'authorization_code')
    params.set('code', input.code)
    params.set('redirect_uri', input.redirectUri)
    params.set('client_id', input.clientId)
    params.set('code_verifier', input.codeVerifier)
    if (input.clientSecret) params.set('client_secret', input.clientSecret)
    return params
  }

  private buildRefreshForm(input: RefreshTokenInput): URLSearchParams {
    const params = new URLSearchParams()
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', input.refreshToken)
    params.set('client_id', input.clientId)
    if (input.clientSecret) params.set('client_secret', input.clientSecret)
    return params
  }

  private async postTokenEndpoint(tenantId: string | undefined, body: URLSearchParams): Promise<TokenResponse> {
    const url = `${MICROSOFT_AUTHORITY_BASE}/${resolveAuthority(tenantId)}/oauth2/v2.0/token`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const data = (await res.json()) as TokenResponse
    if (!res.ok || data.error) {
      throw new Error(`Microsoft OAuth call failed: ${data.error_description ?? data.error ?? res.statusText}`)
    }
    return data
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

export function tokenResponseToExpiresAt(token: TokenResponse, nowMs: number = Date.now()): Date | undefined {
  if (typeof token.expires_in !== 'number') return undefined
  return new Date(nowMs + token.expires_in * 1000)
}

/**
 * Generate a fresh PKCE verifier + S256 challenge pair. The verifier is
 * persisted in the hub's state cookie (`extra.codeVerifier`); the challenge is
 * embedded in the authorize URL. Length follows RFC 7636 (43-128 chars).
 */
export function generatePkcePair(byteLength = 64): { codeVerifier: string; codeChallenge: string } {
  const bytes = crypto.randomBytes(byteLength)
  const codeVerifier = base64UrlEncode(bytes)
  const challenge = crypto.createHash('sha256').update(codeVerifier).digest()
  return { codeVerifier, codeChallenge: base64UrlEncode(challenge) }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decode a Microsoft `id_token` payload without verifying signatures. We do
 * NOT trust the values for authorization (the access token's audience handles
 * that). Used only to harvest `email` / `oid` / `preferred_username` for the
 * channel display name. Returns `{}` on parse failure.
 */
export function decodeIdTokenClaims(idToken: string | undefined): {
  email?: string
  oid?: string
  name?: string
  preferred_username?: string
} {
  if (!idToken) return {}
  const parts = idToken.split('.')
  if (parts.length < 2) return {}
  try {
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4)
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const claims = JSON.parse(decoded) as Record<string, unknown>
    return {
      email: typeof claims.email === 'string' ? claims.email : typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined,
      oid: typeof claims.oid === 'string' ? claims.oid : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      preferred_username: typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined,
    }
  } catch {
    return {}
  }
}
