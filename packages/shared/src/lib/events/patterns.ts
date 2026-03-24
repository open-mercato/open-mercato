export type EventPatternMode = 'single-segment' | 'prefix'

type MatchEventPatternOptions = {
  mode?: EventPatternMode
}

const singleSegmentPatternCache = new Map<string, RegExp>()

function getSingleSegmentPatternRegex(pattern: string): RegExp {
  const existing = singleSegmentPatternCache.get(pattern)
  if (existing) return existing

  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+')

  const compiled = new RegExp(`^${regexPattern}$`)
  singleSegmentPatternCache.set(pattern, compiled)
  return compiled
}

export function matchEventPattern(
  eventName: string,
  pattern: string,
  options?: MatchEventPatternOptions,
): boolean {
  const mode = options?.mode ?? 'single-segment'

  if (pattern === '*') return true
  if (pattern === eventName) return true
  if (!pattern.includes('*')) return false

  if (mode === 'prefix') {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2)
      return eventName.startsWith(prefix + '.')
    }

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1)
      return eventName.startsWith(prefix)
    }

    return false
  }

  return getSingleSegmentPatternRegex(pattern).test(eventName)
}

export function matchAnyEventPattern(
  eventName: string,
  patterns: Iterable<string>,
  options?: MatchEventPatternOptions,
): boolean {
  for (const pattern of patterns) {
    if (matchEventPattern(eventName, pattern, options)) {
      return true
    }
  }

  return false
}

export function matchWebhookEventPattern(eventName: string, pattern: string): boolean {
  return matchEventPattern(eventName, pattern, { mode: 'prefix' })
}

export function matchAnyWebhookEventPattern(eventName: string, patterns: Iterable<string>): boolean {
  return matchAnyEventPattern(eventName, patterns, { mode: 'prefix' })
}
