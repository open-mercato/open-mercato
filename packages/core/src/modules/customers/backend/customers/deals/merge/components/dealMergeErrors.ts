const TRANSLATION_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/

type Translate = (key: string, fallback?: string) => string

function translateServerMessage(message: string, t: Translate): string {
  const trimmed = message.trim()
  if (!TRANSLATION_KEY_PATTERN.test(trimmed)) return trimmed
  const translated = t(trimmed, trimmed)
  return translated === trimmed ? '' : translated
}

function readIssueMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return []
  return details.flatMap((issue) => {
    if (!issue || typeof issue !== 'object') return []
    const message = (issue as { message?: unknown }).message
    return typeof message === 'string' && message.trim() ? [message] : []
  })
}

export function describeDealMergeError(error: unknown, t: Translate, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback
  const record = error as { message?: unknown; error?: unknown; details?: unknown }
  const issues = Array.from(new Set(
    readIssueMessages(record.details).map((message) => translateServerMessage(message, t)).filter(Boolean),
  ))
  if (issues.length > 0) return issues.join(' ')
  const primary = typeof record.error === 'string'
    ? record.error
    : typeof record.message === 'string'
      ? record.message
      : ''
  return translateServerMessage(primary, t) || fallback
}
