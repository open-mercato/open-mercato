export function matchCacheKeyPattern(key: string, pattern: string): boolean {
  let patternIndex = 0
  let keyIndex = 0
  let starIndex = -1
  let keyRetryIndex = 0

  while (keyIndex < key.length) {
    const patternChar = pattern[patternIndex]
    const keyChar = key[keyIndex]

    if (patternChar === '*') {
      starIndex = patternIndex
      keyRetryIndex = keyIndex
      patternIndex += 1
      continue
    }

    if (patternChar === '?' || patternChar === keyChar) {
      patternIndex += 1
      keyIndex += 1
      continue
    }

    if (starIndex !== -1) {
      patternIndex = starIndex + 1
      keyRetryIndex += 1
      keyIndex = keyRetryIndex
      continue
    }

    return false
  }

  while (pattern[patternIndex] === '*') {
    patternIndex += 1
  }

  return patternIndex === pattern.length
}

