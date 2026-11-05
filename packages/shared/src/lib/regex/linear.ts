import { RE2JS } from 're2js'

const DEFAULT_MAX_PATTERN_LENGTH = 500
const DEFAULT_MAX_INPUT_LENGTH = 10_000
const MAX_REGEX_CACHE_SIZE = 256

const compiledRegexCache = new Map<string, RE2JS>()

export type LinearRegexTestOptions = {
  maxPatternLength?: number
  maxInputLength?: number
}

export type LinearRegexTestResult =
  | { ok: true; matched: boolean }
  | { ok: false; reason: 'pattern_too_long' | 'input_too_long' | 'invalid_pattern' }

function getCachedRegex(pattern: string): RE2JS {
  const cached = compiledRegexCache.get(pattern)
  if (cached) return cached

  const compiled = RE2JS.compile(pattern)
  if (compiledRegexCache.size >= MAX_REGEX_CACHE_SIZE) {
    const oldestKey = compiledRegexCache.keys().next().value
    if (oldestKey) compiledRegexCache.delete(oldestKey)
  }
  compiledRegexCache.set(pattern, compiled)
  return compiled
}

export function testLinearRegex(
  pattern: string,
  input: string,
  options: LinearRegexTestOptions = {},
): LinearRegexTestResult {
  const maxPatternLength = options.maxPatternLength ?? DEFAULT_MAX_PATTERN_LENGTH
  const maxInputLength = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH

  if (pattern.length > maxPatternLength) return { ok: false, reason: 'pattern_too_long' }
  if (input.length > maxInputLength) return { ok: false, reason: 'input_too_long' }

  try {
    return { ok: true, matched: getCachedRegex(pattern).test(input) }
  } catch {
    return { ok: false, reason: 'invalid_pattern' }
  }
}

