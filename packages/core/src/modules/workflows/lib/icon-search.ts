/**
 * Icon-name search for the definition icon picker (spec section 4.5:
 * "searchable lucide grid").
 *
 * The grid searches the platform's SHARED lucide registry
 * (`@open-mercato/ui/backend/icons/lucideRegistry`) rather than the full lucide
 * export: that registry is generated from the icon names actually used across
 * the repo and is already in every backend page's chunk through `AppShell`, so
 * the picker adds no icons to the bundle at all. Importing `lucide-react`
 * wholesale would have pulled well over a thousand components into the editor
 * chunk for a field that stores one string.
 *
 * PURE: string in, strings out — no React, no icon components.
 */

/** Enough to fill the grid without rendering a thousand buttons at once. */
export const ICON_SEARCH_RESULT_LIMIT = 120

function normalizeIconQuery(query: string): string {
  return query.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

/**
 * Normalize an author-entered icon value to the registry's kebab-case key.
 *
 * The field has always been free text, so stored values are a mix of
 * `ShoppingCart`, `shopping-cart` and `lucide:shopping-cart`. Matching them all
 * is what lets an existing definition open with its icon selected instead of
 * looking unset.
 */
export function normalizeIconName(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withoutPrefix = trimmed.startsWith('lucide:') ? trimmed.slice('lucide:'.length) : trimmed
  if (!withoutPrefix) return ''
  if (!/[-_\s]/.test(withoutPrefix) && /[A-Z]/.test(withoutPrefix)) {
    return withoutPrefix
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
  }
  return withoutPrefix.replace(/[_\s]+/g, '-').replace(/-+/g, '-').toLowerCase()
}

/**
 * Filter icon names by query, ranking a prefix match above a substring match so
 * typing "cart" surfaces `cart` before `shopping-cart`. Names are compared
 * pairwise for ordering — never an uncompared sort on a shared array (#3620).
 */
export function filterIconNames(
  names: readonly string[],
  query: string,
  limit: number = ICON_SEARCH_RESULT_LIMIT,
): string[] {
  const normalized = normalizeIconQuery(query)
  if (!normalized) return names.slice(0, limit)
  const prefixMatches: string[] = []
  const substringMatches: string[] = []
  for (const name of names) {
    if (name.startsWith(normalized)) prefixMatches.push(name)
    else if (name.includes(normalized)) substringMatches.push(name)
  }
  return [...prefixMatches, ...substringMatches].slice(0, limit)
}
