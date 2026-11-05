/**
 * Mirror of the supervisor-side rules in `scripts/dev-runtime-state.mjs`.
 * The supervisor re-redacts everything it ingests, but the dev-only app route
 * writes reports to a local file first, so the same rules must apply here.
 * `scripts/__tests__/dev-runtime-redaction-parity.test.mjs` keeps the two lists
 * from drifting.
 */
const REDACTION_RULES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***'],
  [/\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?)::?\/\/[^\s'"`<>)]+/gi, '$1://***'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],
  [/\b(authorization|proxy-authorization|x-api-key|x-auth-token)(\s*[:=]\s*)(?:\w+\s+)?\S+/gi, '$1$2***'],
  [/\b(set-cookie|cookie)(\s*[:=]\s*)[^\n]+/gi, '$1$2***'],
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, '***'],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, '***'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '***'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|session[_-]?id)("?\s*[:=]\s*"?)([^\s"',;)}]+)/gi, '$1$2***'],
]

export function redactDevRuntimeText(value: unknown, maxLength = 400): string | undefined {
  if (value == null) return undefined
  let text = String(value)
  for (const [pattern, replacement] of REDACTION_RULES) {
    text = text.replace(pattern, replacement)
  }
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+$/g, '')
  if (!text) return undefined
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}
