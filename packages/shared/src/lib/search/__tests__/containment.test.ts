import { buildContainmentPatterns } from '../containment'

describe('buildContainmentPatterns (#5803)', () => {
  test('splits a multi-word contains pattern into one pattern per word', () => {
    // The token subquery matched every token in any order with anything between them. Reproducing
    // that on SQL means ANDing per word, which is what TC-RESO-009 exercises through the API:
    // `?search=Warehouse <stamp>` has to keep matching `Warehouse A <stamp>`.
    expect(buildContainmentPatterns('%Warehouse 1757%')).toEqual(['%Warehouse%', '%1757%'])
  })

  test('collapses runs of whitespace rather than emitting empty patterns', () => {
    expect(buildContainmentPatterns('%John   Smith%')).toEqual(['%John%', '%Smith%'])
  })

  test('leaves a single-word pattern exactly as the caller declared it', () => {
    // The reported #5803 case: the distinguishing fragment must reach SQL untouched, or the exact
    // row cannot come back at all.
    expect(buildContainmentPatterns('%2026-08%')).toEqual(['%2026-08%'])
  })

  test('leaves a term too short to tokenize alone', () => {
    expect(buildContainmentPatterns('%08%')).toEqual(['%08%'])
  })

  test('keeps escaped wildcards attached to their word', () => {
    // escapeLikePattern turns a literal `%` into `\%`; splitting must not treat it as a wildcard
    // and must not tear the escape off its word.
    expect(buildContainmentPatterns('%50\\% off%')).toEqual(['%50\\%%', '%off%'])
  })

  test('does not split a structured pattern carrying its own wildcards', () => {
    // A caller that hand-built `%a% b%` asked for that exact shape; re-splitting it would silently
    // rewrite a predicate this helper has no business reinterpreting.
    expect(buildContainmentPatterns('%a% b%')).toEqual(['%a% b%'])
  })

  test('does not split an anchored pattern', () => {
    // `startsWith` / `endsWith` terms are anchored on purpose; per-word ANDing would drop the
    // anchor and widen the match.
    expect(buildContainmentPatterns('John Smith%')).toEqual(['John Smith%'])
    expect(buildContainmentPatterns('%John Smith')).toEqual(['%John Smith'])
  })

  test('treats a trailing escaped percent as a literal, not as the closing wildcard', () => {
    expect(buildContainmentPatterns('%John Smith\\%')).toEqual(['%John Smith\\%'])
  })
})
