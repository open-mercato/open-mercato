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

  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+')

  return new RegExp(`^${regexPattern}$`).test(eventName)
}
