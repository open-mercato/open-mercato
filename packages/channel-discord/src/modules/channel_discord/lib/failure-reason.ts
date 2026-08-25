/**
 * Turn an arbitrary thrown value into a one-line reason that is safe to persist
 * and render.
 *
 * The AI auto-reply marker stores this on `channelState` and the settings page
 * renders it, so the string leaves the log and enters the product. An upstream
 * provider error is not a curated message: an HTTP client that echoes the failing
 * URL, or an SDK that quotes the Authorization header, would put a live
 * credential in a JSONB column and on an operator's screen. Redacting is cheap;
 * discovering later that a bot token is sitting in `channel_state` is not.
 *
 * The patterns are deliberately broad-but-anchored — a false positive costs one
 * unreadable fragment of a diagnostic, a false negative costs a leaked secret.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // `Authorization: Bot <token>` / `Bearer <token>`, however it is spelled.
  /\b(?:Bot|Bearer|Basic|token|api[_-]?key|secret|password)\b\s*[:=]?\s*['"]?[A-Za-z0-9._~+/=-]{8,}['"]?/gi,
  // Discord bot tokens and JWT-shaped values: three dot-separated base64url runs.
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}\b/g,
  // Provider API keys that announce themselves with a prefix.
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  // Anything carried in a query string, which is where URLs hide credentials.
  /([?&](?:access_token|token|key|api[_-]?key|secret|signature|sig)=)[^&\s]+/gi,
]

const REDACTED = '[redacted]'

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    // Only the query-string pattern captures a group. `String.replace` passes the
    // match offset in that slot for the patterns that do not, so the type check is
    // load-bearing — without it a redacted value comes back stamped with a number.
    (current, pattern) => current.replace(pattern, (_match, group: unknown) => (
      typeof group === 'string' ? `${group}${REDACTED}` : REDACTED
    )),
    text,
  )
}

/**
 * A one-line, operator-readable reason naming the agent that failed — which is
 * the first thing someone staring at a silent channel needs to know — with the
 * upstream message redacted and its stack left behind.
 */
export function describeAgentFailure(agentId: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const firstLine = raw.split('\n', 1)[0]?.trim() || 'unknown error'
  return `agent ${agentId}: ${redactSecrets(firstLine)}`
}
