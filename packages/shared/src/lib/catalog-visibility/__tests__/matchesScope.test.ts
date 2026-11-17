import { matchesScope } from '../matchesScope'
import type { ScopedProduct } from '../types'
import { CATEGORY_UNIVERSE, mulberry32, randomProduct } from './testFixtures'

describe('matchesScope — list-level OR and the null/[] distinction (§11 item 5)', () => {
  it('null means unrestricted: matches every product', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 50; i += 1) {
      expect(matchesScope(randomProduct(rng, i), null)).toBe(true)
    }
  })

  it('[] (empty list) means deny-all: matches no product, for many varied products', () => {
    const rng = mulberry32(2)
    for (let i = 0; i < 200; i += 1) {
      expect(matchesScope(randomProduct(rng, i), [])).toBe(false)
    }
    const emptyProduct: ScopedProduct = { id: 'empty', categoryIds: [], tagIds: [] }
    expect(matchesScope(emptyProduct, [])).toBe(false)
    const fullProduct: ScopedProduct = { id: 'full', categoryIds: [...CATEGORY_UNIVERSE], tagIds: [] }
    expect(matchesScope(fullProduct, [])).toBe(false)
  })

  it('matches if ANY branch matches (OR across the DNF list)', () => {
    const product: ScopedProduct = { id: 'p', categoryIds: ['cat-b'], tagIds: [] }
    const effective = [{ categoryIds: ['cat-a'] }, { categoryIds: ['cat-b'] }, { categoryIds: ['cat-c'] }]
    expect(matchesScope(product, effective)).toBe(true)
  })

  it('matches nothing when no branch matches', () => {
    const product: ScopedProduct = { id: 'p', categoryIds: ['cat-z'], tagIds: [] }
    const effective = [{ categoryIds: ['cat-a'] }, { categoryIds: ['cat-b'] }]
    expect(matchesScope(product, effective)).toBe(false)
  })
})
