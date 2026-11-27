const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char] ?? char)
}

/** Accepts http(s) URLs and same-origin absolute paths; anything else is dropped. */
export function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString()
  } catch {
    return null
  }
  return null
}

export function paragraphs(text: string): string {
  return text
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}
