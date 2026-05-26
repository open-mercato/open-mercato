/**
 * Thin Gmail OAuth client wrapper. Uses raw `fetch` against Google's well-known
 * endpoints so the adapter can stay agnostic of the `googleapis` SDK and tests
 * can stub `setGoogleOAuthClient(...)` without loading the SDK at all.
 *
 * Endpoints — locked to Google's documented OAuth2 v2 surface:
 *   - Authorize  https://accounts.google.com/o/oauth2/v2/auth
 *   - Token      https://oauth2.googleapis.com/token
 *   - Userinfo   https://www.googleapis.com/oauth2/v3/userinfo
 */

import { parseScopes } from './credentials'

export const GMAIL_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GMAIL_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GMAIL_OAUTH_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

export interface BuildAuthorizeUrlInput {
  clientId: string
  redirectUri: string
  state: string
  scopes: string[]
  loginHint?: string
}

export interface ExchangeCodeInput {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}

export interface RefreshTokenInput {
  clientId: string
  clientSecret: string
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

export interface UserInfoResponse {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

export interface GoogleOAuthClient {
  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string
  exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse>
  refreshToken(input: RefreshTokenInput): Promise<TokenResponse>
  fetchUserInfo(accessToken: string): Promise<UserInfoResponse>
}

class RealGoogleOAuthClient implements GoogleOAuthClient {
  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
    const url = new URL(GMAIL_OAUTH_AUTHORIZE_URL)
    url.searchParams.set('client_id', input.clientId)
    url.searchParams.set('redirect_uri', input.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', (input.scopes.length ? input.scopes : parseScopes(undefined)).join(' '))
    url.searchParams.set('state', input.state)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('include_granted_scopes', 'true')
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
    const res = await fetch(GMAIL_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const body = (await res.json()) as TokenResponse
    if (!res.ok || body.error) {
      throw new Error(`Gmail OAuth code exchange failed: ${body.error_description ?? body.error ?? res.statusText}`)
    }
    return body
  }

  async refreshToken(input: RefreshTokenInput): Promise<TokenResponse> {
    const params = new URLSearchParams()
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', input.refreshToken)
    params.set('client_id', input.clientId)
    params.set('client_secret', input.clientSecret)
    const res = await fetch(GMAIL_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const body = (await res.json()) as TokenResponse
    if (!res.ok || body.error) {
      throw new Error(`Gmail OAuth refresh failed: ${body.error_description ?? body.error ?? res.statusText}`)
    }
    return body
  }

  async fetchUserInfo(accessToken: string): Promise<UserInfoResponse> {
    const res = await fetch(GMAIL_OAUTH_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      throw new Error(`Gmail userinfo fetch failed: ${res.status} ${res.statusText}`)
    }
    return (await res.json()) as UserInfoResponse
  }
}

let cachedClient: GoogleOAuthClient | null = null

export function getGoogleOAuthClient(): GoogleOAuthClient {
  if (!cachedClient) cachedClient = new RealGoogleOAuthClient()
  return cachedClient
}

export function setGoogleOAuthClient(client: GoogleOAuthClient | null): void {
  cachedClient = client
}

export function tokenResponseToExpiresAt(token: TokenResponse, nowMs: number = Date.now()): Date | undefined {
  if (typeof token.expires_in !== 'number') return undefined
  return new Date(nowMs + token.expires_in * 1000)
}
