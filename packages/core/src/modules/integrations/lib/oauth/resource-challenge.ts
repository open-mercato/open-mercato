import type { OAuthResourceChallengeOutcome } from './descriptor'

const BEARER_INSUFFICIENT_SCOPE = /\bbearer\b.*?\berror\s*=\s*(?:"insufficient_scope"|insufficient_scope(?![\w-]))/i
const BARE_TOKEN = 'insufficient_scope'

/**
 * Pure. A 401 or 403 whose `WWW-Authenticate` carries `Bearer … error="insufficient_scope"`
 * or a bare `insufficient_scope` token (case-insensitive) is `'scope_insufficient'`;
 * anything else is `null`.
 */
export function classifyResourceChallenge(status: number, wwwAuthenticate: string | null): OAuthResourceChallengeOutcome | null {
  if (status !== 401 && status !== 403) return null
  if (!wwwAuthenticate) return null
  if (BEARER_INSUFFICIENT_SCOPE.test(wwwAuthenticate)) return 'scope_insufficient'
  const tokens = wwwAuthenticate.split(/[\s,]+/)
  return tokens.some((token) => token.toLowerCase() === BARE_TOKEN) ? 'scope_insufficient' : null
}
