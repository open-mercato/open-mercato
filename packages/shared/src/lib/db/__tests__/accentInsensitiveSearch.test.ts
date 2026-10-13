import { describe, expect, it } from '@jest/globals'
import {
  IMMUTABLE_UNACCENT_FUNCTION,
  buildAccentInsensitivePatternSql,
  buildAccentInsensitiveSearchExpression,
  buildImmutableUnaccentFunctionSql,
} from '../accentInsensitiveSearch'

describe('accent-insensitive search SQL', () => {
  it('builds a NULL-safe, space-separated concatenation wrapped in the immutable unaccent function', () => {
    expect(buildAccentInsensitiveSearchExpression(['title', 'sku'])).toBe(
      `${IMMUTABLE_UNACCENT_FUNCTION}(coalesce("title", '') || ' ' || coalesce("sku", ''))`,
    )
  })

  it('wraps a single column without a separator', () => {
    expect(buildAccentInsensitiveSearchExpression(['title'])).toBe(
      `${IMMUTABLE_UNACCENT_FUNCTION}(coalesce("title", ''))`,
    )
  })

  it('rejects an empty column list rather than emitting an unparsable call', () => {
    expect(() => buildAccentInsensitiveSearchExpression([])).toThrow()
  })

  it('unaccents the bound pattern with the same function, so both sides of the comparison match', () => {
    expect(buildAccentInsensitivePatternSql()).toBe(`${IMMUTABLE_UNACCENT_FUNCTION}(?)`)
  })

  // The wrapper may only be declared IMMUTABLE because the dictionary is pinned:
  // the single-argument unaccent() resolves it through search_path and is STABLE,
  // which PostgreSQL refuses inside an index expression.
  it('pins the text-search dictionary instead of relying on search_path', () => {
    const sql = buildImmutableUnaccentFunctionSql()
    expect(sql).toContain(`create or replace function ${IMMUTABLE_UNACCENT_FUNCTION}(text)`)
    expect(sql).toContain(`public.unaccent('public.unaccent'::regdictionary, $1)`)
    expect(sql).toContain('immutable')
  })
})
