import { intersectScopes } from '../intersectScopes'
import { unionScopes } from '../unionScopes'
import { matchesOne } from '../matchesOne'
import { matchesScope } from '../matchesScope'
import type { AssortmentScope, EffectiveAssortmentScope, ScopedProduct } from '../types'
import { mulberry32, randomAssortmentScope, randomProduct, randomSource } from './testFixtures'

function expectedMatch(product: ScopedProduct, channel: AssortmentScope | null, group: EffectiveAssortmentScope): boolean {
  const channelMatches = channel === null ? true : matchesOne(product, channel)
  return channelMatches && matchesScope(product, group)
}

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
  const CASE_COUNT = 5000

  it('holds exactly for every generated fixture: matchesScope(p, channel ∩ group) === matchesOne(p, channel) && matchesScope(p, group)', () => {
    const rng = mulberry32(202)
    let matchedCases = 0
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const channel = rng() < 0.15 ? null : randomAssortmentScope(rng)
      const sourceCount = Math.floor(rng() * 3)
      const sources = Array.from({ length: sourceCount }, () => randomSource(rng))
      const group = unionScopes(sources)
      const product = randomProduct(rng, i)

      const expected = expectedMatch(product, channel, group)
      expect(matchesScope(product, intersectScopes(channel, group))).toBe(expected)
      if (expected) matchedCases += 1
    }
    expect(matchedCases).toBeGreaterThan(CASE_COUNT / 20)
    expect(matchedCases).toBeLessThan(CASE_COUNT)
  })

  it('stays exact when composed repeatedly (branches that already carry allOf)', () => {
    const rng = mulberry32(303)
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const outer = rng() < 0.15 ? null : randomAssortmentScope(rng)
      const inner = rng() < 0.15 ? null : randomAssortmentScope(rng)
      const sourceCount = Math.floor(rng() * 3)
      const group = unionScopes(Array.from({ length: sourceCount }, () => randomSource(rng)))
      const product = randomProduct(rng, i)

      const composed = intersectScopes(outer, intersectScopes(inner, group))
      const expected = expectedMatch(product, outer, group) && (inner === null || matchesOne(product, inner))
      expect(matchesScope(product, composed)).toBe(expected)
    }
  })

  it('never drops a branch: the result is [] only when the group itself is []', () => {
    const rng = mulberry32(404)
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const channel = randomAssortmentScope(rng)
      const sourceCount = Math.floor(rng() * 3)
      const group = unionScopes(Array.from({ length: sourceCount }, () => randomSource(rng)))
      const result = intersectScopes(channel, group)
      if (group === null) {
        expect(result).toEqual([channel])
      } else {
        expect(result).toHaveLength(group.length)
      }
    }
    expect(intersectScopes({ categoryIds: ['cat-a'] }, [])).toEqual([])
  })
})

describe('intersectScopes — incomparable category/tag sets are ANDed exactly via allOf', () => {
  it('regression: channel [Electronics] ∩ group [Clearance] grants a product in both categories', () => {
    const channel: AssortmentScope = { categoryIds: ['electronics'] }
    const group = unionScopes([{ categoryIds: ['clearance'] }])
    const result = intersectScopes(channel, group)

    expect(result).toEqual([{ categoryIds: ['electronics'], allOf: [{ categoryIds: ['clearance'] }] }])

    const inBoth: ScopedProduct = { id: 'tv', categoryIds: ['electronics', 'clearance'], tagIds: [] }
    const electronicsOnly: ScopedProduct = { id: 'phone', categoryIds: ['electronics'], tagIds: [] }
    const clearanceOnly: ScopedProduct = { id: 'sofa', categoryIds: ['clearance'], tagIds: [] }
    expect(matchesScope(inBoth, result)).toBe(true)
    expect(matchesScope(electronicsOnly, result)).toBe(false)
    expect(matchesScope(clearanceOnly, result)).toBe(false)
  })

  it('a product satisfying channel and group via two different, non-overlapping tag ids is granted', () => {
    const channel: AssortmentScope = { tagIds: ['channel-only'] }
    const group = unionScopes([{ tagIds: ['group-only'] }])
    const product: ScopedProduct = { id: 'p', categoryIds: [], tagIds: ['channel-only', 'group-only'] }
    expect(matchesScope(product, intersectScopes(channel, group))).toBe(true)
  })

  it('a product satisfying only one side is denied', () => {
    const channel: AssortmentScope = { tagIds: ['channel-only'] }
    const group = unionScopes([{ tagIds: ['group-only'] }])
    const productChannelOnly: ScopedProduct = { id: 'p', categoryIds: [], tagIds: ['channel-only'] }
    expect(matchesScope(productChannelOnly, intersectScopes(channel, group))).toBe(false)
  })

  it('overlapping but non-subset sets match through different ids on each side', () => {
    const channel: AssortmentScope = { tagIds: ['t2', 't4', 't5'] }
    const group = unionScopes([{ tagIds: ['t2', 't3'] }])
    const product: ScopedProduct = { id: 'p2', categoryIds: [], tagIds: ['t3', 't4'] }
    expect(matchesScope(product, intersectScopes(channel, group))).toBe(true)
  })

  it('keeps the other dimension and excludes merged flat alongside the allOf residual', () => {
    const channel: AssortmentScope = { categoryIds: ['cat-a'], tagIds: ['tag-a'], excludeProductIds: ['p-x'] }
    const group = unionScopes([{ categoryIds: ['cat-b'], excludeTagIds: ['tag-z'] }])
    expect(intersectScopes(channel, group)).toEqual([
      {
        categoryIds: ['cat-a'],
        tagIds: ['tag-a'],
        excludeProductIds: ['p-x'],
        excludeTagIds: ['tag-z'],
        allOf: [{ categoryIds: ['cat-b'] }],
      },
    ])
  })
})

describe('intersectScopes — exact flat merges', () => {
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

  it('excludes always union exactly', () => {
    const channel: AssortmentScope = { excludeCategoryIds: ['cat-x'] }
    const group = unionScopes([{ excludeTagIds: ['tag-y'] }])
    const result = intersectScopes(channel, group)
    expect(result).toEqual([{ excludeCategoryIds: ['cat-x'], excludeTagIds: ['tag-y'] }])
  })
})
