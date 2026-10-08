import {
  OAuthDescriptorError,
  OAuthGrantError,
  resolveOAuthProviderDescriptor,
  type OAuthProviderDescriptor,
} from './descriptor'
import { OAuthTokenEndpointError, requestTokenEndpoint, type OAuthTokenEndpointResponse } from './token-endpoint'

const PROTOCOL_AUTHORIZE_PARAMS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
])

const CLIENT_REJECTION_ERRORS = new Set(['invalid_client', 'unauthorized_client'])

/**
 * Authorization-code request URL: `response_type=code`, `client_id`, `redirect_uri`, `scope`
 * (space-joined `scopes ?? defaultScopes`), `state` and, unless `pkce` is `'none'`,
 * `code_challenge` with `code_challenge_method=S256`; then `extraAuthorizeParams`, which never
 * override those keys. Throws `OAuthDescriptorError` (field `codeChallenge`) when the challenge
 * is missing while PKCE is on.
 */
export function buildAuthorizationUrl(descriptor: OAuthProviderDescriptor, input: {
  clientId: string
  redirectUri: string
  state: string
  scopes?: readonly string[]
  codeChallenge?: string
}): string {
  const resolved = resolveOAuthProviderDescriptor(descriptor)
  const usesPkce = resolved.pkce !== 'none'
  if (usesPkce && !input.codeChallenge) throw new OAuthDescriptorError('codeChallenge')
  const url = new URL(resolved.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  const scope = (input.scopes ?? resolved.defaultScopes).join(' ')
  if (scope.length > 0) url.searchParams.set('scope', scope)
  url.searchParams.set('state', input.state)
  if (usesPkce && input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  for (const [key, value] of Object.entries(resolved.extraAuthorizeParams)) {
    if (PROTOCOL_AUTHORIZE_PARAMS.has(key)) continue
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/** Throws OAuthGrantError: `connect_state_invalid` (missing verifier, before any network call),
 *  `client_misconfigured` (`invalid_client`, `unauthorized_client`), `connect_exchange_failed` (anything else). */
export async function exchangeAuthorizationCode(
  descriptor: OAuthProviderDescriptor,
  client: { clientId: string; clientSecret: string },
  input: { code: string; redirectUri: string; codeVerifier?: string },
): Promise<OAuthTokenEndpointResponse> {
  const resolved = resolveOAuthProviderDescriptor(descriptor)
  const usesPkce = resolved.pkce !== 'none'
  if (usesPkce && !input.codeVerifier) throw new OAuthGrantError('connect_state_invalid')
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  }
  if (usesPkce && input.codeVerifier) params.code_verifier = input.codeVerifier
  try {
    return await requestTokenEndpoint({
      url: resolved.tokenEndpoint,
      client: { clientId: client.clientId, clientSecret: client.clientSecret, authMethod: resolved.clientAuthMethod },
      params,
    })
  } catch (error) {
    if (!(error instanceof OAuthTokenEndpointError)) throw error
    const cause = error.salvagedRefreshToken === null ? error : undefined
    if (error.kind === 'protocol' && error.error !== null && CLIENT_REJECTION_ERRORS.has(error.error)) {
      throw new OAuthGrantError('client_misconfigured', { providerErrorCode: error.error, cause })
    }
    throw new OAuthGrantError('connect_exchange_failed', { providerErrorCode: error.error, cause })
  }
}
