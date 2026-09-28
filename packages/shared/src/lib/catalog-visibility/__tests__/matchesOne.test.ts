import { matchesOne } from '../matchesOne'
import type { ScopedProduct } from '../types'

const product = (overrides: Partial<ScopedProduct> = {}): ScopedProduct => ({
  id: 'product-1',
  categoryIds: ['cat-a'],
  tagIds: ['tag-a'],
  ...overrides,
})

describe('matchesOne — within-one-scope AND/OR semantics (§11 item 6)', () => {
  it('categoryIds OR-matches: any overlapping id is enough', () => {
    expect(matchesOne(product({ categoryIds: ['cat-a', 'cat-b'] }), { categoryIds: ['cat-b', 'cat-c'] })).toBe(true)
    expect(matchesOne(product({ categoryIds: ['cat-x'] }), { categoryIds: ['cat-b', 'cat-c'] })).toBe(false)
  })

  it('tagIds OR-matches: any overlapping id is enough', () => {
    expect(matchesOne(product({ tagIds: ['tag-a', 'tag-b'] }), { tagIds: ['tag-b', 'tag-c'] })).toBe(true)
    expect(matchesOne(product({ tagIds: ['tag-x'] }), { tagIds: ['tag-b', 'tag-c'] })).toBe(false)
  })

  it('categoryIds AND tagIds both required when both are present on the scope', () => {
    const scope = { categoryIds: ['cat-a'], tagIds: ['tag-a'] }
    expect(matchesOne(product({ categoryIds: ['cat-a'], tagIds: ['tag-a'] }), scope)).toBe(true)
    expect(matchesOne(product({ categoryIds: ['cat-a'], tagIds: ['tag-z'] }), scope)).toBe(false)
    expect(matchesOne(product({ categoryIds: ['cat-z'], tagIds: ['tag-a'] }), scope)).toBe(false)
  })

  it('excludeProductIds vetoes a match already granted by inclusion', () => {
    const scope = { categoryIds: ['cat-a'], excludeProductIds: ['product-1'] }
    expect(matchesOne(product({ id: 'product-1', categoryIds: ['cat-a'] }), scope)).toBe(false)
    expect(matchesOne(product({ id: 'product-2', categoryIds: ['cat-a'] }), scope)).toBe(true)
  })

  it('excludeCategoryIds vetoes a match already granted by inclusion', () => {
    const scope = { tagIds: ['tag-a'], excludeCategoryIds: ['cat-x'] }
    expect(matchesOne(product({ tagIds: ['tag-a'], categoryIds: ['cat-x'] }), scope)).toBe(false)
    expect(matchesOne(product({ tagIds: ['tag-a'], categoryIds: ['cat-y'] }), scope)).toBe(true)
  })

  it('excludeTagIds vetoes a match already granted by inclusion', () => {
    const scope = { categoryIds: ['cat-a'], excludeTagIds: ['tag-x'] }
    expect(matchesOne(product({ categoryIds: ['cat-a'], tagIds: ['tag-x'] }), scope)).toBe(false)
    expect(matchesOne(product({ categoryIds: ['cat-a'], tagIds: ['tag-y'] }), scope)).toBe(true)
  })

  it('excludes combine independently — each can veto on its own', () => {
    const scope = {
      excludeProductIds: ['product-1'],
      excludeCategoryIds: ['cat-x'],
      excludeTagIds: ['tag-x'],
    }
    expect(matchesOne(product({ id: 'other', categoryIds: ['cat-y'], tagIds: ['tag-y'] }), scope)).toBe(true)
    expect(matchesOne(product({ id: 'product-1', categoryIds: ['cat-y'], tagIds: ['tag-y'] }), scope)).toBe(false)
    expect(matchesOne(product({ id: 'other', categoryIds: ['cat-x'], tagIds: ['tag-y'] }), scope)).toBe(false)
    expect(matchesOne(product({ id: 'other', categoryIds: ['cat-y'], tagIds: ['tag-x'] }), scope)).toBe(false)
  })
})

describe('matchesOne — empty array and absent key equivalence (§11 item 7)', () => {
  it('absent categoryIds and empty categoryIds both mean unrestricted', () => {
    const p = product({ categoryIds: ['anything'] })
    expect(matchesOne(p, {})).toBe(true)
    expect(matchesOne(p, { categoryIds: [] })).toBe(true)
  })

  it('absent tagIds and empty tagIds both mean unrestricted', () => {
    const p = product({ tagIds: ['anything'] })
    expect(matchesOne(p, {})).toBe(true)
    expect(matchesOne(p, { tagIds: [] })).toBe(true)
  })

  it('absent excludeProductIds and empty excludeProductIds both mean no veto', () => {
    const p = product({ id: 'product-1' })
    expect(matchesOne(p, {})).toBe(true)
    expect(matchesOne(p, { excludeProductIds: [] })).toBe(true)
  })

  it('absent excludeCategoryIds and empty excludeCategoryIds both mean no veto', () => {
    const p = product({ categoryIds: ['cat-a'] })
    expect(matchesOne(p, {})).toBe(true)
    expect(matchesOne(p, { excludeCategoryIds: [] })).toBe(true)
  })

  it('absent excludeTagIds and empty excludeTagIds both mean no veto', () => {
    const p = product({ tagIds: ['tag-a'] })
    expect(matchesOne(p, {})).toBe(true)
    expect(matchesOne(p, { excludeTagIds: [] })).toBe(true)
  })

  it('a fully empty scope object matches every product', () => {
    expect(matchesOne(product({ categoryIds: [], tagIds: [] }), {})).toBe(true)
    expect(matchesOne(product({ categoryIds: ['x', 'y'], tagIds: ['z'] }), {})).toBe(true)
  })
})
