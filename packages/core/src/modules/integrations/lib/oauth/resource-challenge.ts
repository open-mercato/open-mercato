import type { OAuthResourceChallengeOutcome } from './descriptor'

const BEARER_INSUFFICIENT_SCOPE = /\bbearer\b.*?(?:^|[\s,])error\s*=\s*(?:"insufficient_scope"|insufficient_scope(?![\w-]))/i
const BARE_TOKEN = 'insufficient_scope'
const QUOTED_INSUFFICIENT_SCOPE = `"${BARE_TOKEN}"`
const QUOTED_STRING = /"(?:[^"\\]|\\.)*"/g

function blankQuotedValues(wwwAuthenticate: string): string {
  return wwwAuthenticate.replace(QUOTED_STRING, (quoted) => (quoted.toLowerCase() === QUOTED_INSUFFICIENT_SCOPE ? quoted : '""'))
}

/**
 * Pure. A 401 or 403 whose `WWW-Authenticate` carries `Bearer … error="insufficient_scope"`
 * or a bare `insufficient_scope` token (case-insensitive) is `'scope_insufficient'`;
 * anything else is `null`. Words inside other quoted values, such as `error_description`, never match.
 */
export function classifyResourceChallenge(status: number, wwwAuthenticate: string | null): OAuthResourceChallengeOutcome | null {
  if (status !== 401 && status !== 403) return null
  if (!wwwAuthenticate) return null
  const header = blankQuotedValues(wwwAuthenticate)
  if (BEARER_INSUFFICIENT_SCOPE.test(header)) return 'scope_insufficient'
  const tokens = header.split(/[\s,]+/)
  return tokens.some((token) => token.toLowerCase() === BARE_TOKEN) ? 'scope_insufficient' : null
}
