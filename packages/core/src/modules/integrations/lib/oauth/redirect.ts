import { AppOriginConfigurationError, AppOriginRejectedError, toSecurityEmailUrl } from '@open-mercato/shared/lib/url'
import { OAuthGrantError } from './descriptor'

/**
 * Builds an OAuth redirect URI from `APP_URL` only (keeping its path prefix), never from the
 * request origin; outside production without `APP_URL` it falls back to `http://localhost:3000`.
 * When given, `req` must come from an allowed app origin (`Host`, `X-Forwarded-Host`, URL).
 * `path` must start with `/`.
 * Throws `OAuthGrantError('oauth_base_url_not_configured')` in production without `APP_URL`
 * and `OAuthGrantError('connect_origin_rejected')` for a request from another origin.
 */
export function resolveOAuthRedirectUri(req: Request | undefined, path: string): string {
  if (!path.startsWith('/')) throw new TypeError('[internal] OAuth redirect path must start with "/"')
  try {
    return toSecurityEmailUrl(req, path)
  } catch (error) {
    if (error instanceof AppOriginConfigurationError) throw new OAuthGrantError('oauth_base_url_not_configured', { cause: error })
    if (error instanceof AppOriginRejectedError) throw new OAuthGrantError('connect_origin_rejected', { cause: error })
    throw error
  }
}
