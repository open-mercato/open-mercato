/**
 * Substitutes `{{path.to.value}}` from the run context into authored copy.
 *
 * Deliberately minimal — no expressions, no conditionals, no loops. Campaign copy is authored
 * by marketers in a text field, and a template language here would be a template language to
 * secure. An unresolved placeholder is left verbatim rather than blanked, so a typo is visible
 * in the sent message instead of producing a silently empty sentence.
 */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export type InterpolateSink = 'text' | 'html'

/**
 * Substitutes placeholders, escaping for the sink.
 *
 * `sink: 'html'` is mandatory when the result becomes email HTML. Substituted values include
 * customer-controlled data — a display name is settable from the portal in many deployments — so an
 * unescaped substitution lets a customer inject markup, most usefully a link, into a message
 * delivered from the tenant's own verified sending domain, where it inherits that domain's
 * reputation. Subjects and plain-text bodies are not HTML sinks and are left verbatim.
 */
export function interpolate(
  template: string,
  values: Record<string, unknown>,
  sink: InterpolateSink = 'text',
): string {
  return template.replace(PLACEHOLDER, (match, path: string) => {
    const value = readPath(values, path)
    if (value === null || value === undefined) return match
    if (typeof value === 'object') return match
    const rendered = String(value)
    return sink === 'html' ? escapeHtml(rendered) : rendered
  })
}
