import { sanitizeRichTextHref } from '@open-mercato/shared/lib/html/sanitizeRichText'

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const URL_SCHEME_OR_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i

export function sanitizeMessageActionHref(value: string): string | null {
  const href = sanitizeRichTextHref(value)
  if (!href || CONTROL_CHARACTERS.test(href) || URL_SCHEME_OR_AUTHORITY.test(href)) return null
  return href
}
