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
 * Cap on the persisted reason. The marker lives in a JSONB column and renders in
 * a banner, so an unbounded provider message would bloat both. Applied AFTER
 * redaction, never before, so truncation can never be what saves a secret.
 */
const MAX_REASON_LENGTH = 300

/** How many validation issues are worth naming before the reason stops reading like a sentence. */
const MAX_ZOD_ISSUES = 3

/**
 * Lines that are pure structure — the `[`, `{`, `}]` of a pretty-printed error —
 * and carry nothing an operator can act on.
 */
const PUNCTUATION_ONLY_LINE = /^[[\]{}(),]+$/

/**
 * A stack frame embedded in the message itself. Dropping every line but the
 * first used to keep these out by accident; now that later lines are kept for
 * the information they carry, they have to be excluded on purpose.
 */
const STACK_FRAME_LINE = /^at\s/

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncateReason(text: string): string {
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text
}

function describeZodIssue(issue: unknown): string | null {
  if (!issue || typeof issue !== 'object') return null
  const { path, message } = issue as { path?: unknown; message?: unknown }
  const text = typeof message === 'string' ? collapseWhitespace(message) : ''
  if (!text) return null
  const location = Array.isArray(path)
    ? path.filter((segment) => typeof segment === 'string' || typeof segment === 'number').join('.')
    : ''
  return location ? `${location}: ${text}` : text
}

/**
 * A `ZodError` is the most likely failure on this path — it is what the compose
 * validator throws — and it is precisely the class the old first-line rule
 * mangled: `ZodError.message` is pretty-printed JSON, so its first line is a
 * bare `[` and the operator's banner read `agent <id>: [` (#5603).
 *
 * Duck-typed rather than `instanceof`: the error crosses a package boundary and
 * may come from a different zod copy than this package resolves. Anything
 * carrying a non-empty `issues` array of `{ path, message }` is described the
 * same way, which is the shape that matters here.
 */
function describeZodIssues(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const issues = (err as { issues?: unknown }).issues
  if (!Array.isArray(issues) || issues.length === 0) return null
  const described = issues.slice(0, MAX_ZOD_ISSUES).map(describeZodIssue).filter(Boolean)
  if (described.length === 0) return null
  const omitted = issues.length - described.length
  return `${described.join('; ')}${omitted > 0 ? ` (+${omitted} more)` : ''}`
}

/**
 * Everything else: keep the whole message, minus the structural noise, folded
 * onto one line. Dropping all but the first line threw away the informative part
 * of any multi-line error, not just Zod's.
 */
function describeRawMessage(raw: string): string {
  const meaningful = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !PUNCTUATION_ONLY_LINE.test(line) && !STACK_FRAME_LINE.test(line),
    )
  return collapseWhitespace(meaningful.join(' ')) || 'unknown error'
}

/**
 * A one-line, operator-readable reason naming the agent that failed — which is
 * the first thing someone staring at a silent channel needs to know — with the
 * upstream message redacted and its stack left behind.
 */
export function describeAgentFailure(agentId: string, err: unknown): string {
  const reason =
    describeZodIssues(err) ?? describeRawMessage(err instanceof Error ? err.message : String(err))
  return `agent ${agentId}: ${truncateReason(redactSecrets(reason))}`
}
