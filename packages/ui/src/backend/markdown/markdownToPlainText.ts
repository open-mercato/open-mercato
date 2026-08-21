const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const code = Number(dec)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(NAMED_HTML_ENTITIES, name) ? NAMED_HTML_ENTITIES[name] : match,
    )
}

/**
 * Converts a Markdown (or legacy HTML) string into a plain-text preview suitable for compact,
 * read-only contexts such as DataTable list cells. Strips Markdown syntax, strips HTML tags, and
 * decodes HTML entities, then collapses whitespace. Handling legacy HTML keeps list previews clean
 * for records authored before the editor moved back to Markdown — no data migration required.
 *
 * This is NOT a sanitizer — render rich content with the Markdown components, not this helper.
 */
export function markdownToPlainText(input: string | null | undefined): string {
  if (!input) return ''
  let text = String(input)
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  text = text.replace(/^>\s?/gm, '')
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/~~([^~]+)~~/g, '$1')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')
  text = text.replace(/\|/g, ' ')
  text = decodeHtmlEntities(text)
  text = text.replace(/\s+/g, ' ').trim()
  return text
}
