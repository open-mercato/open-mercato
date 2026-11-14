const SINGLE_QUOTE_PATTERN = /[\u2018\u2019\u201a\u201b\u2032`\u00b4]/g
const DOUBLE_QUOTE_PATTERN = /[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g
const WHITESPACE_PATTERN = /^[\s\u200b]$/u

export function normalizeFindingCharacter(character: string): string {
  if (WHITESPACE_PATTERN.test(character)) return ' '
  return character
    .replace(SINGLE_QUOTE_PATTERN, "'")
    .replace(DOUBLE_QUOTE_PATTERN, '"')
}

export function normalizeFindingText(value: string): string {
  let normalized = ''
  for (const character of value) {
    const mapped = normalizeFindingCharacter(character)
    if (mapped === ' ' && (normalized.length === 0 || normalized.endsWith(' '))) continue
    normalized += mapped
  }
  return normalized.trimEnd()
}

export function findingTextMatches(currentText: string, quote: string): boolean {
  const expected = normalizeFindingText(quote)
  return expected.length > 0 && normalizeFindingText(currentText) === expected
}
