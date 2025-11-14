import { sanitizeSearchTerm, parseBooleanFlag, buildFilters } from '../attribute-schemas/route'

describe('catalog attribute schema route helpers', () => {
  it('sanitizes search terms by trimming and stripping wildcards', () => {
    expect(sanitizeSearchTerm('  discount_% ')).toBe('discount')
    expect(sanitizeSearchTerm(undefined)).toBe('')
  })

  it('parses boolean query flags', () => {
    expect(parseBooleanFlag('true')).toBe(true)
    expect(parseBooleanFlag('false')).toBe(false)
    expect(parseBooleanFlag('other')).toBeUndefined()
  })

  it('builds filters combining fuzzy search, status, and soft delete handling', async () => {
    const filters = await buildFilters({
      search: '  promo_% ',
      isActive: 'false',
      withDeleted: false,
    } as any)

    expect(filters.$or).toEqual([
      { name: { $ilike: '%promo%' } },
      { code: { $ilike: '%promo%' } },
      { description: { $ilike: '%promo%' } },
    ])
    expect(filters.is_active).toBe(false)
    expect(filters.deleted_at).toBeNull()
  })

  it('omits deleted filter when withDeleted flag is true', async () => {
    const filters = await buildFilters({ withDeleted: true } as any)
    expect(filters.deleted_at).toBeUndefined()
  })
})
