import { unionScopes } from '../unionScopes'
import { matchesScope } from '../matchesScope'
import type { ScopedProduct } from '../types'

describe('unionScopes — R2 regression: union is OR across dimensions, not flattened AND', () => {
  it('keeps each source as its own unmodified OR-branch, exact shape', () => {
    const result = unionScopes([{ categoryIds: ['A'] }, { tagIds: ['B'] }])
    expect(result).toEqual([{ categoryIds: ['A'] }, { tagIds: ['B'] }])
  })

  it('a product in category A but NOT tagged B is granted by the category-A branch alone', () => {
    const result = unionScopes([{ categoryIds: ['A'] }, { tagIds: ['B'] }])
    const product: ScopedProduct = { id: 'p1', categoryIds: ['A'], tagIds: [] }
    expect(matchesScope(product, result)).toBe(true)
  })

  it('a product tagged B but NOT in category A is granted by the tag-B branch alone', () => {
    const result = unionScopes([{ categoryIds: ['A'] }, { tagIds: ['B'] }])
    const product: ScopedProduct = { id: 'p2', categoryIds: [], tagIds: ['B'] }
    expect(matchesScope(product, result)).toBe(true)
  })

  it('a product with neither category A nor tag B is granted by neither branch', () => {
    const result = unionScopes([{ categoryIds: ['A'] }, { tagIds: ['B'] }])
    const product: ScopedProduct = { id: 'p3', categoryIds: ['Z'], tagIds: ['Y'] }
    expect(matchesScope(product, result)).toBe(false)
  })

  it('the naive flattened-AND mistake would have wrongly rejected the category-A-only product', () => {
    // Documented as a regression guard: the first draft merged sources into one flat
    // AssortmentScope ({ categoryIds: ['A'], tagIds: ['B'] }), which AND's the two
    // dimensions together instead of OR-ing the two sources. Assert that shape is NOT
    // what unionScopes produces, and that evaluating against it would give the wrong answer.
    const flattenedWrong = { categoryIds: ['A'], tagIds: ['B'] }
    const product: ScopedProduct = { id: 'p1', categoryIds: ['A'], tagIds: [] }
    expect(matchesScope(product, [flattenedWrong])).toBe(false) // the bug: wrongly denied
    expect(matchesScope(product, unionScopes([{ categoryIds: ['A'] }, { tagIds: ['B'] }]))).toBe(true) // the fix
  })
})

describe('unionScopes — null propagation (§11 item 3)', () => {
  it('any unrestricted (null) source makes the whole union unrestricted', () => {
    expect(unionScopes([null, { categoryIds: ['A'] }])).toBeNull()
    expect(unionScopes([{ categoryIds: ['A'] }, null])).toBeNull()
  })

  it('no sources at all is unrestricted', () => {
    expect(unionScopes([])).toBeNull()
  })

  it('multiple non-null sources with no null among them stay a DNF list', () => {
    const result = unionScopes([{ categoryIds: ['A'] }, { categoryIds: ['B'] }])
    expect(result).toEqual([{ categoryIds: ['A'] }, { categoryIds: ['B'] }])
  })

  it("returns a fresh array, never the caller's own list", () => {
    const input = [{ categoryIds: ['A'] }, { tagIds: ['B'] }]
    const result = unionScopes(input)
    expect(result).not.toBe(input)
    expect(result).toEqual(input)
  })
})
