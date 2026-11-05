export type WildcardMatchOptions = {
  singleSegmentWildcard?: boolean
}

function matchWildcardSegment(pattern: string, value: string, options: WildcardMatchOptions): boolean {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let valueRetryIndex = 0

  while (valueIndex < value.length) {
    const patternChar = pattern[patternIndex]
    const valueChar = value[valueIndex]

    if (patternChar === '*') {
      starIndex = patternIndex
      valueRetryIndex = valueIndex
      patternIndex += 1
      continue
    }

    if (patternChar === valueChar) {
      patternIndex += 1
      valueIndex += 1
      continue
    }

    if (
      starIndex !== -1
      && (!options.singleSegmentWildcard || value[valueRetryIndex] !== '.')
    ) {
      patternIndex = starIndex + 1
      valueRetryIndex += 1
      valueIndex = valueRetryIndex
      continue
    }

    return false
  }

  while (pattern[patternIndex] === '*') {
    patternIndex += 1
  }

  return patternIndex === pattern.length
}

export function matchWildcardPattern(
  value: string,
  pattern: string,
  options: WildcardMatchOptions = {},
): boolean {
  if (pattern === value) return true
  if (pattern === '*') return true
  if (!pattern.includes('*')) return false

  return matchWildcardSegment(pattern, value, options)
}

