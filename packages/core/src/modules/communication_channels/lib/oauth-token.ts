/**
 * Shared OAuth2 token primitives for email channel providers. The authorize-URL
 * shape, PKCE usage, and userinfo handling differ per provider (Gmail vs
 * Microsoft) and stay in each package — but the token response shape, the
 * form-urlencoded token POST, and the expiry computation are identical, so they
 * live here.
 */

export interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}

/** Compute the absolute access-token expiry from `expires_in`, or `undefined` when absent. */
export function tokenResponseToExpiresAt(
  token: OAuthTokenResponse,
  nowMs: number = Date.now(),
): Date | undefined {
  if (typeof token.expires_in !== 'number') return undefined
  return new Date(nowMs + token.expires_in * 1000)
}

/**
 * POST a form-urlencoded body to an OAuth token endpoint and return the parsed
 * token response. Throws `${errorLabel}: <reason>` when the endpoint returns a
 * non-2xx status or an `error` field.
 */
export async function requestOAuthToken(
  tokenUrl: string,
  params: URLSearchParams,
  options: { errorLabel: string },
): Promise<OAuthTokenResponse> {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const body = (await res.json()) as OAuthTokenResponse
  if (!res.ok || body.error) {
    throw new Error(`${options.errorLabel}: ${body.error_description ?? body.error ?? res.statusText}`)
  }
  return body
}
