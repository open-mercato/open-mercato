/**
 * Splits a `contains` like/ilike pattern into one pattern per whitespace-separated word, so a
 * plaintext column taken off the hashed-token path keeps the word-order-independent matching the
 * token index provided.
 *
 * The token path matches a value when it carries EVERY token of the term, in any order and with
 * anything in between: `?search=Warehouse 1757` matches `Warehouse A 1757`. A single verbatim
 * `name ILIKE '%Warehouse 1757%'` is literal substring containment, so the `A ` sitting between the
 * two words defeats it — that is a capability every list grid has today, and #5803's fix must not
 * take it away (`TC-RESO-009` pins it).
 *
 * ANDing one containment predicate per word reproduces the token semantics exactly on a column the
 * engine can read, without the token path's two lossy steps: nothing is dropped for being shorter
 * than `minTokenLength` (`?search=08` filters instead of matching every row) and nothing is split on
 * non-alphanumerics (`?search=2026-08` no longer collapses onto `2026-01`).
 *
 * Splitting is deliberately narrow — a pattern is only split when it is unambiguously the
 * `%term%` shape `buildIlikeTerm(value, 'contains')` produces:
 *
 * - it opens and closes with a wildcard `%` (a trailing `\%` is an escaped literal, not a wildcard);
 * - the term between them carries no unescaped `%` or `_`, so a hand-built structured pattern such
 *   as `%a% b%` is left exactly as the caller wrote it;
 * - the term holds at least two words.
 *
 * Anything else returns the input unchanged as a single pattern, which is the caller's existing
 * behavior.
 */
export function buildContainmentPatterns(pattern: string): string[] {
  if (!isWrappedContainsPattern(pattern)) return [pattern]
  const term = pattern.slice(1, -1)
  if (hasUnescapedWildcard(term)) return [pattern]
  const words = term.split(/\s+/).filter((word) => word.length > 0)
  if (words.length < 2) return [pattern]
  return words.map((word) => `%${word}%`)
}

function isWrappedContainsPattern(pattern: string): boolean {
  if (pattern.length < 2) return false
  if (!pattern.startsWith('%') || !pattern.endsWith('%')) return false
  return countTrailingBackslashes(pattern, pattern.length - 2) % 2 === 0
}

function hasUnescapedWildcard(term: string): boolean {
  for (let index = 0; index < term.length; index += 1) {
    const char = term[index]
    if (char !== '%' && char !== '_') continue
    if (countTrailingBackslashes(term, index - 1) % 2 === 0) return true
  }
  return false
}

function countTrailingBackslashes(value: string, fromIndex: number): number {
  let count = 0
  for (let index = fromIndex; index >= 0 && value[index] === '\\'; index -= 1) count += 1
  return count
}
