export type RuleTextPart = { kind: 'text' | 'code'; value: string }

const CODE_TOKEN = new RegExp(
  [
    '--[a-z][a-z0-9-]*',
    '[A-Za-z][A-Za-z0-9]*=(?:"[^"]*"|\\{[^}]*\\})',
    '(?:rounded|text|bg|border|gap|space|shadow|font|size|flex|grid|max|min|[pmwhz][xytblrse]?)-(?:\\[[^\\]]+\\]|[a-z0-9]+(?:-[a-z0-9]+)*(?:-\\[[^\\]]+\\])?)',
    '[a-z]+(?:[A-Z][a-z0-9]+)+(?:\\([^)]*\\))?',
    '[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+',
  ].join('|'),
  'g',
)

export function splitRuleText(text: string): RuleTextPart[] {
  const parts: RuleTextPart[] = []
  let cursor = 0
  for (const match of text.matchAll(CODE_TOKEN)) {
    const start = match.index ?? 0
    const before = text[start - 1]
    if (before !== undefined && /[A-Za-z0-9-]/.test(before)) continue
    if (start > cursor) parts.push({ kind: 'text', value: text.slice(cursor, start) })
    parts.push({ kind: 'code', value: match[0] })
    cursor = start + match[0].length
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) })
  return parts
}
