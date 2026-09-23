import { tokenizeHtml } from './tokenizer'

/** Elements whose text content is never part of the readable document. */
export const NON_CONTENT_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'math',
  'title',
  'iframe',
  'object',
])

export const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

/** Non-breaking and typographic spaces that must fold into an ordinary space. */
const UNICODE_SPACES = new RegExp('[\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]', 'g')

export function normalizeWhitespace(text: string): string {
  return text
    .replace(UNICODE_SPACES, ' ')
    .replace(/[ \t\f\r\v]+/g, ' ')
    // The collapse above leaves at most one space on either side of a newline,
    // so ` ?` is equivalent to ` *` here — and, unlike ` *`, does not backtrack
    // quadratically over long runs of spaces (CodeQL polynomial ReDoS).
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function htmlToText(html: string): string {
  const parts: string[] = []
  let skipName: string | null = null
  let skipDepth = 0

  for (const token of tokenizeHtml(html)) {
    if (token.kind === 'open') {
      if (skipName !== null) {
        if (token.name === skipName) skipDepth += 1
        continue
      }
      if (NON_CONTENT_ELEMENTS.has(token.name)) {
        skipName = token.name
        skipDepth = 1
        continue
      }
      if (BLOCK_ELEMENTS.has(token.name)) parts.push('\n')
      continue
    }
    if (token.kind === 'close') {
      if (skipName !== null) {
        if (token.name === skipName) {
          skipDepth -= 1
          if (skipDepth <= 0) skipName = null
        }
        continue
      }
      if (BLOCK_ELEMENTS.has(token.name)) parts.push('\n')
      continue
    }
    if (skipName !== null) continue
    parts.push(token.value)
  }

  return normalizeWhitespace(parts.join(''))
}

export function extractTitle(html: string): string | null {
  let inTitle = false
  let title = ''
  for (const token of tokenizeHtml(html)) {
    if (token.kind === 'open') {
      if (token.name === 'title') inTitle = true
      else if (token.name === 'body') break
      continue
    }
    if (token.kind === 'close') {
      if (token.name === 'title') break
      continue
    }
    if (inTitle) title += token.value
  }
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}
