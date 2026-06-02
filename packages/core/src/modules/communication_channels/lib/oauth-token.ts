/**
 * Shared OAuth2 token primitives for email channel providers. The authorize-URL
 * shape, PKCE usage, and userinfo handling differ per provider (e.g. Gmail)
 * and stay in each package — but the token response shape, the
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

/** Hard timeout for a token endpoint round-trip (ms). Overridable via env. */
const DEFAULT_OAUTH_TOKEN_TIMEOUT_MS = 10_000

function resolveTokenTimeoutMs(): number {
  const fromEnv = Number.parseInt(process.env.OM_OAUTH_TOKEN_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_OAUTH_TOKEN_TIMEOUT_MS
}

/**
 * POST a form-urlencoded body to an OAuth token endpoint and return the parsed
 * token response. Throws `${errorLabel}: <reason>` when the endpoint returns a
 * non-2xx status, an `error` field, a non-JSON body, or does not respond within
 * the timeout. Bounding the request matters because token refresh sits on the
 * critical path of every poll/send — a hung token endpoint must fail fast, not
 * block the worker, and a proxy HTML error page must surface the real status
 * rather than a confusing JSON `SyntaxError`.
 */
export async function requestOAuthToken(
  tokenUrl: string,
  params: URLSearchParams,
  options: { errorLabel: string },
): Promise<OAuthTokenResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), resolveTokenTimeoutMs())
  let res: Response
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${options.errorLabel}: token endpoint timed out`)
    }
    throw new Error(`${options.errorLabel}: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timeout)
  }

  const raw = await res.text()
  let body: OAuthTokenResponse
  try {
    body = JSON.parse(raw) as OAuthTokenResponse
  } catch {
    throw new Error(`${options.errorLabel}: non-JSON response (status ${res.status})`)
  }
  if (!res.ok || body.error) {
    throw new Error(`${options.errorLabel}: ${body.error_description ?? body.error ?? res.statusText}`)
  }
  return body
}
