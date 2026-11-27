export type CodeTokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'tag' | 'attribute' | 'number' | 'punctuation'

export type CodeToken = { kind: CodeTokenKind; value: string }

const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'async', 'await', 'new', 'type', 'interface', 'extends', 'as', 'true', 'false', 'null', 'undefined', 'typeof',
  'void', 'throw', 'try', 'catch', 'finally', 'class', 'this', 'in', 'of', 'yarn', 'npx', 'node',
])

const PATTERN = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)',
    '(<\\/?)([A-Za-z][\\w.]*)',
    '([A-Za-z_$][\\w$-]*)(?==(?:["\'{`]))',
    '(\\b\\d+(?:\\.\\d+)?\\b)',
    '([A-Za-z_$][\\w$]*)',
    '([{}()[\\];,.<>=/:+\\-*!?&|]+)',
  ].join('|'),
  'g',
)

export function tokenizeCode(code: string): CodeToken[] {
  const tokens: CodeToken[] = []
  const push = (kind: CodeTokenKind, value: string) => {
    if (!value) return
    const last = tokens[tokens.length - 1]
    if (last && last.kind === kind && kind === 'plain') last.value += value
    else tokens.push({ kind, value })
  }
  let cursor = 0
  for (const match of code.matchAll(PATTERN)) {
    const index = match.index ?? 0
    push('plain', code.slice(cursor, index))
    const [whole, comment, text, tagOpen, tagName, attribute, numeric, word, punctuation] = match
    if (comment) push('comment', comment)
    else if (text) push('string', text)
    else if (tagName) {
      push('punctuation', tagOpen)
      push('tag', tagName)
    } else if (attribute) push('attribute', attribute)
    else if (numeric) push('number', numeric)
    else if (word) push(KEYWORDS.has(word) ? 'keyword' : 'plain', word)
    else if (punctuation) push('punctuation', punctuation)
    else push('plain', whole)
    cursor = index + whole.length
  }
  push('plain', code.slice(cursor))
  return tokens
}

export const CODE_TOKEN_CLASS: Record<CodeTokenKind, string> = {
  plain: 'text-foreground',
  comment: 'text-muted-foreground',
  string: 'text-status-success-text',
  keyword: 'text-status-info-text',
  tag: 'text-status-info-text',
  attribute: 'text-foreground',
  number: 'text-status-info-text',
  punctuation: 'text-muted-foreground',
}
