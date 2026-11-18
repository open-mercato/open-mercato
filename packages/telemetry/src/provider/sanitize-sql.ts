/**
 * Replaces every literal in a Postgres statement with `?` so span attributes
 * keep the query shape but never the values. MikroORM inlines bound parameters
 * into the SQL text before it reaches `pg`, so `enhancedDatabaseReporting: false`
 * alone cannot keep record content, user ids or session ids out of spans.
 *
 * Kept: keywords, `"quoted identifiers"`, `$1` placeholders, operators.
 * Replaced: quoted strings (including `E'…'`, `B'…'`, `X'…'`, `N'…'`),
 * dollar-quoted strings, numeric literals and `true` / `false`.
 * Dropped: comments, since they can carry arbitrary text.
 *
 * Returns `undefined` when the text cannot be tokenized (an unterminated
 * quote or comment) so the caller can fail closed instead of exporting it.
 */
export const REDACTED_SQL_STATEMENT = '[redacted]'

const LITERAL_PLACEHOLDER = '?'
const STRING_PREFIXES = new Set(['e', 'b', 'x', 'n'])
const BOOLEAN_LITERALS = new Set(['true', 'false'])
const NUMBER_PATTERN = /^(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[\p{L}\p{N}_]*/u
const DOLLAR_TAG_PATTERN = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u
const WORD_PATTERN = /^[\p{L}_][\p{L}\p{N}_$]*/u
const WORD_START_PATTERN = /[\p{L}_]/u
const IDENTIFIER_CHAR_PATTERN = /[\p{L}\p{N}_$]/u

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_CHAR_PATTERN.test(char)
}

function skipBlockComment(text: string, start: number): number | undefined {
  let depth = 0
  let index = start
  while (index < text.length) {
    if (text[index] === '/' && text[index + 1] === '*') {
      depth += 1
      index += 2
      continue
    }
    if (text[index] === '*' && text[index + 1] === '/') {
      depth -= 1
      index += 2
      if (depth === 0) return index
      continue
    }
    index += 1
  }
  return undefined
}

function skipQuotedString(text: string, start: number, backslashEscapes: boolean): number | undefined {
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (backslashEscapes && char === '\\') {
      index += 2
      continue
    }
    if (char === "'") {
      if (text[index + 1] === "'") {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return undefined
}

function skipQuotedIdentifier(text: string, start: number): number | undefined {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '"') {
      if (text[index + 1] === '"') {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return undefined
}

export function sanitizeSqlStatement(text: string): string | undefined {
  let output = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const previous = index > 0 ? text[index - 1] : undefined

    if (char === "'") {
      const end = skipQuotedString(text, index, false)
      if (end === undefined) return undefined
      output += LITERAL_PLACEHOLDER
      index = end
      continue
    }

    if (char === '"') {
      const end = skipQuotedIdentifier(text, index)
      if (end === undefined) return undefined
      output += text.slice(index, end)
      index = end
      continue
    }

    if (char === '-' && text[index + 1] === '-') {
      const newline = text.indexOf('\n', index)
      index = newline === -1 ? text.length : newline
      continue
    }

    if (char === '/' && text[index + 1] === '*') {
      const end = skipBlockComment(text, index)
      if (end === undefined) return undefined
      output += ' '
      index = end
      continue
    }

    if (char === '$' && !isIdentifierChar(previous)) {
      const placeholder = /^\$\d+/.exec(text.slice(index))
      if (placeholder) {
        output += placeholder[0]
        index += placeholder[0].length
        continue
      }
      const tag = DOLLAR_TAG_PATTERN.exec(text.slice(index))
      if (tag) {
        const end = text.indexOf(tag[0], index + tag[0].length)
        if (end === -1) return undefined
        output += LITERAL_PLACEHOLDER
        index = end + tag[0].length
        continue
      }
    }

    if (!isIdentifierChar(previous) && /[0-9.]/.test(char)) {
      const number = NUMBER_PATTERN.exec(text.slice(index))
      if (number) {
        output += LITERAL_PLACEHOLDER
        index += number[0].length
        continue
      }
    }

    if (!isIdentifierChar(previous) && WORD_START_PATTERN.test(char)) {
      const word = WORD_PATTERN.exec(text.slice(index))?.[0] ?? char
      const lowered = word.toLowerCase()
      const afterWord = index + word.length
      if (STRING_PREFIXES.has(lowered) && text[afterWord] === "'") {
        const end = skipQuotedString(text, afterWord, lowered === 'e')
        if (end === undefined) return undefined
        output += LITERAL_PLACEHOLDER
        index = end
        continue
      }
      output += BOOLEAN_LITERALS.has(lowered) ? LITERAL_PLACEHOLDER : word
      index = afterWord
      continue
    }

    output += char
    index += 1
  }
  return output
}
