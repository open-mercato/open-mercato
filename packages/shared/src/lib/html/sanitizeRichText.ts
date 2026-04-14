import sanitizeHtml from 'sanitize-html'

export const RICH_TEXT_ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'u',
  'ul',
] as const

const RICH_TEXT_DROP_WITH_CONTENT_TAGS = [
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'object',
  'option',
  'script',
  'select',
  'style',
  'svg',
  'textarea',
] as const

const HTML_LIKE_PATTERN = /<\/?[a-z][\s\S]*>/i

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export type RichTextPasteContent = {
  command: 'insertHTML' | 'insertText'
  value: string
}

export function sanitizeRichTextHtml(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return ''

  return sanitizeHtml(value, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: {
      a: ['href', 'title'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    nonTextTags: [...RICH_TEXT_DROP_WITH_CONTENT_TAGS],
  })
}

export function sanitizeRichTextHref(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const html = sanitizeRichTextHtml(`<a href="${escapeAttribute(trimmed)}">x</a>`)
  const match = /\shref="([^"]+)"/.exec(html)
  return match ? trimmed : null
}

export function sanitizeRichTextPasteContent(html: string, text: string): RichTextPasteContent | null {
  if (html) {
    return { command: 'insertHTML', value: sanitizeRichTextHtml(html) }
  }

  if (!text) return null

  if (HTML_LIKE_PATTERN.test(text)) {
    return { command: 'insertHTML', value: sanitizeRichTextHtml(text) }
  }

  return { command: 'insertText', value: text }
}
