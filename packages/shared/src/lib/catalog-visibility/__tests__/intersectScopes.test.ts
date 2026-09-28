import { intersectScopes } from '../intersectScopes'
import { unionScopes } from '../unionScopes'
import { matchesOne } from '../matchesOne'
import { matchesScope } from '../matchesScope'
import type { AssortmentScope, EffectiveAssortmentScope, ScopedProduct } from '../types'
import { hasIncomparableDimensionConflict, mulberry32, randomAssortmentScope, randomProduct, randomSource } from './testFixtures'

describe('intersectScopes — null handling (§11 item 4)', () => {
  it('intersectScopes(A, null) is equivalent to [A]: matches iff matchesOne(product, A)', () => {
    const channel: AssortmentScope = { categoryIds: ['cat-a'] }
    const result = intersectScopes(channel, null)
    expect(result).toEqual([channel])

    const rng = mulberry32(11)
    for (let i = 0; i < 100; i += 1) {
      const product = randomProduct(rng, i)
      expect(matchesScope(product, result)).toBe(matchesOne(product, channel))
    }
  })

  it('intersectScopes(null, null) is null', () => {
    expect(intersectScopes(null, null)).toBeNull()
  })

  it('intersectScopes(null, group) returns group unchanged', () => {
    const group: EffectiveAssortmentScope = [{ categoryIds: ['cat-a'] }, { tagIds: ['tag-b'] }]
    expect(intersectScopes(null, group)).toBe(group)
    expect(intersectScopes(null, [])).toEqual([])
  })
})

describe('intersectScopes — distributive law (§11 item 2, property-based)', () => {
  const CASE_COUNT = 3000

  it('is always sound: whenever intersectScopes says match, the true AND also matches (zero tolerance)', () => {
    const rng = mulberry32(101)
    let checked = 0
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const channel = rng() < 0.15 ? null : randomAssortmentScope(rng)
      const sourceCount = Math.floor(rng() * 3)
      const sources = Array.from({ length: sourceCount }, () => randomSource(rng))
      const group = unionScopes(sources)
      const product = randomProduct(rng, i)

      const actual = matchesScope(product, intersectScopes(channel, group))
      const channelMatches = channel === null ? true : matchesOne(product, channel)
      const expected = channelMatches && matchesScope(product, group)

      if (actual) expect(expected).toBe(true)
      checked += 1
    }
    expect(checked).toBe(CASE_COUNT)
  })

  it('holds exactly (full equality) whenever no dimension has an incomparable channel/group conflict', () => {
    const rng = mulberry32(202)
    let exactCasesChecked = 0
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const channel = rng() < 0.15 ? null : randomAssortmentScope(rng)
      const sourceCount = Math.floor(rng() * 3)
      const sources = Array.from({ length: sourceCount }, () => randomSource(rng))
      const group = unionScopes(sources)
      const product = randomProduct(rng, i)

      const groupBranches = group ?? []
      if (hasIncomparableDimensionConflict(channel, groupBranches)) continue

      const actual = matchesScope(product, intersectScopes(channel, group))
      const channelMatches = channel === null ? true : matchesOne(product, channel)
      const expected = channelMatches && matchesScope(product, group)

      expect(actual).toBe(expected)
      exactCasesChecked += 1
    }
    // Sanity: the "no conflict" branch must not be vacuous, or this test would pass by doing nothing.
    expect(exactCasesChecked).toBeGreaterThan(CASE_COUNT / 4)
  })

  it('the incomparable-dimension case is reachable by the generator (sanity check for the test above)', () => {
    const rng = mulberry32(202)
    let conflictCasesSeen = 0
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const channel = rng() < 0.15 ? null : randomAssortmentScope(rng)
      const sourceCount = Math.floor(rng() * 3)
      const sources = Array.from({ length: sourceCount }, () => randomSource(rng))
      const group = unionScopes(sources)
      randomProduct(rng, i)
      if (hasIncomparableDimensionConflict(channel, group ?? [])) conflictCasesSeen += 1
    }
    expect(conflictCasesSeen).toBeGreaterThan(0)
  })
})

describe('intersectScopes — documented approximation boundary', () => {
  // AssortmentScope.categoryIds/tagIds only express an existential ("has ANY of these ids").
  // There is no way to encode "must independently satisfy channel's existential AND this
  // group branch's existential" as a single existential set when a product satisfies each
  // via a *different*, non-shared id — see intersectScopes.ts's own doc comment. This is a
  // structural limitation of the DNF-of-existentials type, not a bug: the implementation is
  // sound (never over-grants) and only under-grants inside this narrow, documented boundary.
  it('a product satisfying channel and group via two different, non-overlapping ids is denied (safe direction)', () => {
    const channel: AssortmentScope = { tagIds: ['channel-only'] }
    const group = unionScopes([{ tagIds: ['group-only'] }])
    const product: ScopedProduct = { id: 'p', categoryIds: [], tagIds: ['channel-only', 'group-only'] }

    // The mathematically pure target is TRUE: the product overlaps the channel's tag set via
    // "channel-only" AND overlaps the group's tag set via "group-only".
    expect(matchesOne(product, channel) && matchesScope(product, group)).toBe(true)

    // intersectScopes cannot represent this exactly and conservatively denies it instead of
    // risking an over-grant.
    expect(matchesScope(product, intersectScopes(channel, group))).toBe(false)
  })

  it('a product satisfying only one side is correctly denied either way', () => {
    const channel: AssortmentScope = { tagIds: ['channel-only'] }
    const group = unionScopes([{ tagIds: ['group-only'] }])
    const productChannelOnly: ScopedProduct = { id: 'p', categoryIds: [], tagIds: ['channel-only'] }
    expect(matchesScope(productChannelOnly, intersectScopes(channel, group))).toBe(false)
  })

  it('overlapping (but not subset) sets still fall inside the documented boundary', () => {
    const channel: AssortmentScope = { tagIds: ['t2', 't4', 't5'] }
    const group = unionScopes([{ tagIds: ['t2', 't3'] }])
    const product: ScopedProduct = { id: 'p2', categoryIds: [], tagIds: ['t3', 't4'] }

    // True target: matches channel via t4, matches group via t3 — different ids again, even
    // though the two tag sets themselves share t2.
    expect(matchesOne(product, channel) && matchesScope(product, group)).toBe(true)
    expect(matchesScope(product, intersectScopes(channel, group))).toBe(false)
  })
})

describe('intersectScopes — exact cases outside the documented boundary', () => {
  it('one side unrestricted on a dimension: the other side wins unmodified', () => {
    const channel: AssortmentScope = { categoryIds: ['cat-a'] }
    const group = unionScopes([{ tagIds: ['tag-a'] }])
    const result = intersectScopes(channel, group)
    expect(result).toEqual([{ categoryIds: ['cat-a'], tagIds: ['tag-a'] }])
  })

  it('one set is a subset of the other: the subset wins, exactly', () => {
    const channel: AssortmentScope = { categoryIds: ['cat-a', 'cat-b'] }
    const group = unionScopes([{ categoryIds: ['cat-a'] }])
    const result = intersectScopes(channel, group)
    expect(result).toEqual([{ categoryIds: ['cat-a'] }])

    const productWithOnlyCatA: ScopedProduct = { id: 'p', categoryIds: ['cat-a'], tagIds: [] }
    const productWithOnlyCatB: ScopedProduct = { id: 'p2', categoryIds: ['cat-b'], tagIds: [] }
    expect(matchesScope(productWithOnlyCatA, result)).toBe(true)
    expect(matchesScope(productWithOnlyCatB, result)).toBe(false)
  })

  it('excludes always union exactly, regardless of the category/tag boundary', () => {
    const channel: AssortmentScope = { excludeCategoryIds: ['cat-x'] }
    const group = unionScopes([{ excludeTagIds: ['tag-y'] }])
    const result = intersectScopes(channel, group)
    expect(result).toEqual([{ excludeCategoryIds: ['cat-x'], excludeTagIds: ['tag-y'] }])
  })
})
