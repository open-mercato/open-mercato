import { canonicalizeEffectiveScope } from '../canonicalizeEffectiveScope'
import { hashEffectiveScope } from '../hashEffectiveScope'
import type { AssortmentScope, EffectiveAssortmentScope } from '../types'
import { mulberry32, randomAssortmentScope } from './testFixtures'

function shuffle<T>(rng: () => number, items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const held = copy[index]
    copy[index] = copy[swap]
    copy[swap] = held
  }
  return copy
}

function shuffleScope(rng: () => number, scope: AssortmentScope): AssortmentScope {
  const entries = shuffle(rng, Object.entries(scope)).map(([key, value]) => {
    if (key === 'allOf') {
      return [key, shuffle(rng, (value as AssortmentScope[]).map((nested) => shuffleScope(rng, nested)))]
    }
    return [key, shuffle(rng, value as string[])]
  })
  return Object.fromEntries(entries) as AssortmentScope
}

function randomEffective(rng: () => number): EffectiveAssortmentScope {
  if (rng() < 0.1) return null
  const branches: AssortmentScope[] = []
  const count = Math.floor(rng() * 4)
  for (let index = 0; index < count; index += 1) {
    const branch = randomAssortmentScope(rng)
    if (rng() < 0.3) {
      branch.allOf = [randomAssortmentScope(rng), randomAssortmentScope(rng)]
    }
    branches.push(branch)
  }
  return branches
}

describe('canonicalizeEffectiveScope', () => {
  it('distinguishes unrestricted (null) from deny-all ([])', () => {
    expect(canonicalizeEffectiveScope(null)).toBe('null')
    expect(canonicalizeEffectiveScope([])).toBe('[]')
    expect(hashEffectiveScope(null)).not.toBe(hashEffectiveScope([]))
  })

  it('treats empty arrays as absent keys', () => {
    expect(canonicalizeEffectiveScope([{ categoryIds: [], tagIds: ['t1'], excludeTagIds: [] }])).toBe(
      canonicalizeEffectiveScope([{ tagIds: ['t1'] }]),
    )
    expect(canonicalizeEffectiveScope([{ categoryIds: [], allOf: [] }])).toBe(canonicalizeEffectiveScope([{}]))
  })

  it('keeps an empty branch (matches everything) distinct from no branches', () => {
    expect(canonicalizeEffectiveScope([{}])).toBe('[{}]')
    expect(canonicalizeEffectiveScope([{}])).not.toBe(canonicalizeEffectiveScope([]))
  })

  it('is invariant to key order, id order and duplicate ids', () => {
    const left: EffectiveAssortmentScope = [{ tagIds: ['b', 'a', 'a'], categoryIds: ['y', 'x'] }]
    const right: EffectiveAssortmentScope = [{ categoryIds: ['x', 'y'], tagIds: ['a', 'b'] }]
    expect(canonicalizeEffectiveScope(left)).toBe(canonicalizeEffectiveScope(right))
    expect(hashEffectiveScope(left)).toBe(hashEffectiveScope(right))
  })

  it('is invariant to branch order and collapses identical branches', () => {
    const forward: EffectiveAssortmentScope = [{ categoryIds: ['a'] }, { tagIds: ['b'] }]
    const reversed: EffectiveAssortmentScope = [{ tagIds: ['b'] }, { categoryIds: ['a'] }, { categoryIds: ['a'] }]
    expect(canonicalizeEffectiveScope(forward)).toBe(canonicalizeEffectiveScope(reversed))
  })

  it('canonicalizes nested allOf entries and their order', () => {
    const left: EffectiveAssortmentScope = [
      { categoryIds: ['a'], allOf: [{ tagIds: ['t2', 't1'] }, { excludeProductIds: ['p1'], allOf: [{ categoryIds: ['c2', 'c1'] }] }] },
    ]
    const right: EffectiveAssortmentScope = [
      { allOf: [{ allOf: [{ categoryIds: ['c1', 'c2'] }], excludeProductIds: ['p1'] }, { tagIds: ['t1', 't2'] }], categoryIds: ['a'] },
    ]
    expect(canonicalizeEffectiveScope(left)).toBe(canonicalizeEffectiveScope(right))
  })

  it('distinguishes scopes that match differently', () => {
    expect(canonicalizeEffectiveScope([{ categoryIds: ['a'] }])).not.toBe(canonicalizeEffectiveScope([{ tagIds: ['a'] }]))
    expect(canonicalizeEffectiveScope([{ categoryIds: ['a'], tagIds: ['b'] }])).not.toBe(
      canonicalizeEffectiveScope([{ categoryIds: ['a'] }, { tagIds: ['b'] }]),
    )
    expect(canonicalizeEffectiveScope([{ categoryIds: ['a'] }])).not.toBe(
      canonicalizeEffectiveScope([{ excludeCategoryIds: ['a'] }]),
    )
  })
})

describe('hashEffectiveScope', () => {
  it('returns 16 lowercase hex characters', () => {
    expect(hashEffectiveScope([{ categoryIds: ['a'] }])).toMatch(/^[0-9a-f]{16}$/)
    expect(hashEffectiveScope(null)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('property: shuffling branch, key and id order preserves the hash', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = mulberry32(seed)
      const scope = randomEffective(rng)
      const shuffled = scope === null ? null : shuffle(rng, scope.map((branch) => shuffleScope(rng, branch)))
      expect(hashEffectiveScope(shuffled)).toBe(hashEffectiveScope(scope))
    }
  })

  it('property: equal canonical form if and only if equal hash across random pairs', () => {
    const rng = mulberry32(4242)
    const scopes: EffectiveAssortmentScope[] = []
    for (let index = 0; index < 60; index += 1) scopes.push(randomEffective(rng))
    for (const left of scopes) {
      for (const right of scopes) {
        const sameCanonical = canonicalizeEffectiveScope(left) === canonicalizeEffectiveScope(right)
        const sameHash = hashEffectiveScope(left) === hashEffectiveScope(right)
        expect(sameHash).toBe(sameCanonical)
      }
    }
  })
})
