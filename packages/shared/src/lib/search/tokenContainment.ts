import { sql, type RawBuilder } from 'kysely'
import { MAX_CONTAINMENT_WORDS } from './containment'
import { NON_DECOMPOSING_FOLDS, normalizeSearchText } from './tokenize'

/**
 * Narrowing companion of the hashed search-token rewrite for PLAINTEXT base columns (#5803).
 *
 * With `OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS` off (the default, per #5383) both query
 * engines still answer a like/ilike on a plaintext column from `search_tokens`. That lookup is lossy:
 * it splits on non-alphanumerics and drops fragments shorter than `minTokenLength`, so `2026-08`
 * and `2026-01` both reduce to {202, 2026} and the wrong record comes back. The engines therefore
 * AND the token predicate with the containment predicate built here. It can only remove rows,
 * never add them.
 *
 * The containment is computed in the tokenizer's own normalized space, so it never rejects a row
 * for a difference the token index deliberately ignores:
 *
 * - the term goes through `normalizeSearchText` (NFKD, combining marks stripped, non-decomposing
 *   Latin letters folded, lowercased) and the column through the SQL mirror of the same fold
 *   ({@link buildFoldedSearchTextExpression}), compared with ILIKE — `Lukasz` still matches
 *   `Łukasz`, `muller` still matches `Müller`;
 * - each whitespace-separated word becomes one pattern made only of its `[a-z0-9]` runs joined by
 *   `%`, so separators are not compared (`2026/08` matches `2026-08`) while every run, including
 *   the short ones the tokenizer drops, must be present in order (`2026-08` no longer matches
 *   `2026-01`, `08` no longer matches everything);
 * - words stay independent of each other, keeping the token path's word-order independence
 *   (`Warehouse 1757` still matches `Warehouse A 1757`, TC-RESO-009).
 *
 * The patterns contain nothing but ASCII letters, digits and `%`, so no LIKE escaping is needed.
 * Terms with more than {@link MAX_CONTAINMENT_WORDS} words, or a word with more than that many
 * runs, return no patterns: the caller then keeps the token predicate alone, which bounds the
 * SQL an attacker-controlled term can compile into.
 */
export function buildTokenContainmentPatterns(value: string): string[] {
  const patterns: string[] = []
  for (const word of normalizeSearchText(value).split(/\s+/)) {
    const runs = word.split(/[^a-z0-9]+/).filter((run) => run.length > 0)
    if (!runs.length) continue
    if (runs.length > MAX_CONTAINMENT_WORDS) return []
    const pattern = `%${runs.join('%')}%`
    if (!patterns.includes(pattern)) patterns.push(pattern)
  }
  if (patterns.length > MAX_CONTAINMENT_WORDS) return []
  return patterns
}

const COMBINING_MARKS_PATTERN = '[̀-ͯ]'
const SINGLE_CHAR_FOLDS = Object.entries(NON_DECOMPOSING_FOLDS).filter(([, fold]) => fold.length === 1)
const MULTI_CHAR_FOLDS = Object.entries(NON_DECOMPOSING_FOLDS).filter(([, fold]) => fold.length > 1)
const SINGLE_FOLD_FROM = SINGLE_CHAR_FOLDS.map(([char]) => char).join('')
const SINGLE_FOLD_TO = SINGLE_CHAR_FOLDS.map(([, fold]) => fold).join('')

/**
 * SQL mirror of `normalizeSearchText` minus the final lowercasing (callers compare with ILIKE):
 * NFKD, combining marks U+0300–U+036F removed, then the non-decomposing Latin folds. Requires a
 * UTF-8 database (Postgres `normalize()`), which every supported deployment uses.
 */
export function buildFoldedSearchTextExpression(column: string | RawBuilder<unknown>): RawBuilder<string> {
  const source = typeof column === 'string' ? sql.ref(column) : column
  let folded: RawBuilder<string> = sql<string>`translate(regexp_replace(normalize((${source})::text, NFKD), ${COMBINING_MARKS_PATTERN}, '', 'g'), ${SINGLE_FOLD_FROM}, ${SINGLE_FOLD_TO})`
  for (const [char, fold] of MULTI_CHAR_FOLDS) {
    folded = sql<string>`replace(${folded}, ${char}, ${fold})`
  }
  return folded
}

export function buildTokenContainmentPredicate(
  column: string | RawBuilder<unknown>,
  patterns: string[],
): RawBuilder<boolean> {
  if (!patterns.length) return sql<boolean>`true`
  const folded = buildFoldedSearchTextExpression(column)
  if (patterns.length === 1) return sql<boolean>`${folded} ilike ${patterns[0]}`
  return sql<boolean>`${folded} ilike all (array[${sql.join(patterns)}]::text[])`
}
