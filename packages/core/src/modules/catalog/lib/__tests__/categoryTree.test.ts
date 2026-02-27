import { formatCategoryTreeLabel } from '../categoryTree'

describe('formatCategoryTreeLabel', () => {
  it('returns plain name for depth 0', () => {
    expect(formatCategoryTreeLabel('Electronics', 0)).toBe('Electronics')
  })

  it('returns arrow-prefixed name for depth 1', () => {
    expect(formatCategoryTreeLabel('Phones', 1)).toBe('↳ Phones')
  })

  it('returns indented arrow-prefixed name for depth 2', () => {
    const result = formatCategoryTreeLabel('Smartphones', 2)
    expect(result).toBe('\u00A0\u00A0↳ Smartphones')
  })

  it('increases indentation for deeper levels', () => {
    const result = formatCategoryTreeLabel('Cases', 3)
    expect(result).toBe('\u00A0\u00A0\u00A0\u00A0↳ Cases')
  })

  it('returns plain name for negative depth', () => {
    expect(formatCategoryTreeLabel('Root', -1)).toBe('Root')
  })
})
