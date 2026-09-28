/**
 * Substitutes `{{path.to.value}}` from the run context into authored copy.
 *
 * Deliberately minimal — no expressions, no conditionals, no loops. Campaign copy is authored
 * by marketers in a text field, and a template language here would be a template language to
 * secure. An unresolved placeholder is left verbatim rather than blanked, so a typo is visible
 * in the sent message instead of producing a silently empty sentence.
 */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export function interpolate(template: string, values: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (match, path: string) => {
    const value = readPath(values, path)
    if (value === null || value === undefined) return match
    if (typeof value === 'object') return match
    return String(value)
  })
}
