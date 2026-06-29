import { matchWildcardPattern } from '@open-mercato/shared/lib/patterns/wildcard'

export type EventPatternMode = 'single-segment' | 'prefix'

type MatchEventPatternOptions = {
  mode?: EventPatternMode
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

  return matchWildcardPattern(eventName, pattern, { singleSegmentWildcard: true })
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
