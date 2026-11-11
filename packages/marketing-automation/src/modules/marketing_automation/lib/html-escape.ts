/**
 * Escaping for the module's two PUBLIC pages, which are hand-built HTML rather than React.
 *
 * Every other screen here is JSX, where React escapes for us. These two are strings, because a person clicking a
 * link in an email gets one self-contained page with no stylesheet to fetch and nothing to track — and that page
 * had a reflected XSS once, from interpolating request bytes into an attribute.
 *
 * What these functions are for is the values that are NOT literals: a resolved locale, a translated title. The
 * translations themselves come from this module's own locale files and may legitimately carry markup (`<strong>`
 * around a score), so body fragments are composed unescaped on purpose — the rule is that anything reaching a
 * TEXT position as a bare value goes through `escapeText`, and anything reaching an attribute through
 * `escapeAttribute`, whoever produced it.
 */

/** Text position: the five characters that can end a text node or open a tag. */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Attribute position: the same set, since every attribute here is double-quoted. */
export function escapeAttribute(value: string): string {
  return escapeText(value)
}
