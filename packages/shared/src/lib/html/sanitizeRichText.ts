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
  'hr',
  'i',
  'img',
  'input',
  'label',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
] as const

const RICH_TEXT_DROP_WITH_CONTENT_TAGS = [
  'button',
  'embed',
  'form',
  'iframe',
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
      img: ['src', 'alt', 'width', 'height'],
      table: ['style'],
      tr: [],
      td: ['colspan', 'rowspan', 'style'],
      th: ['colspan', 'rowspan', 'style'],
      input: ['type', 'checked', 'disabled'],
      label: [],
      span: ['style'],
      p: ['style'],
      div: ['style'],
      ul: ['data-task-list', 'style'],
      ol: ['style'],
      li: ['style'],
      h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'], h6: ['style'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    nonTextTags: [...RICH_TEXT_DROP_WITH_CONTENT_TAGS],
    allowedStyles: {
      '*': {
        'color': [/^#(?:[0-9a-f]{3}){1,2}$/i, /^rgb\([\d,\s]+\)$/i, /^rgba\([\d.,\s]+\)$/i],
        'background-color': [/^#(?:[0-9a-f]{3}){1,2}$/i, /^rgb\([\d,\s]+\)$/i, /^rgba\([\d.,\s]+\)$/i],
        'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        'font-weight': [/^(?:normal|bold|\d{3})$/],
        'font-style': [/^(?:normal|italic|oblique)$/],
        'text-align': [/^(?:left|right|center|justify)$/],
        'text-decoration': [/^(?:none|underline|line-through)$/],
        'width': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        'height': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        'border': [/^[\w\-:#.,\s()]+$/],
        'border-collapse': [/^(?:collapse|separate)$/],
        'padding': [/^[\d.\spxemr%]+$/],
        'list-style': [/^(?:none|disc|circle|square|decimal)$/],
        'padding-left': [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/],
      },
    },
    transformTags: {
      // Restrict <input> to checkbox toggles only — strip any other `type` so
      // text/file/etc. inputs don't slip through the rich text channel.
      'input': (tagName, attribs) => {
        if (attribs.type === 'checkbox') {
          return { tagName: 'input', attribs }
        }
        return { tagName: '', attribs: {}, text: '' }
      },
    },
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
