import {
  applyDocumentHistoryFilters,
  applyDocumentHistoryPage,
  applyDocumentHistorySort,
  buildDocumentHistoryUrl,
  buildDocumentTemplatesUrl,
  createDocumentHistoryFilterState,
  documentHistoryQueryKey,
  documentTemplatesQueryKey,
  isDocumentHistoryQueryEnabled,
  resolveLastValidDocumentHistoryPage,
} from '../document-queries'

describe('document template URL and key', () => {
  it('serializes snake_case params and repeats tags', () => {
    const url = buildDocumentTemplatesUrl({ resourceKind: 'sales.order', documentType: 'invoice', format: 'pdf', tags: ['a', 'b'] })
    expect(url).toBe('/api/document-generators/templates?resource_kind=sales.order&document_type=invoice&format=pdf&tags=a&tags=b')
  })

  it('omits empty values', () => {
    expect(buildDocumentTemplatesUrl({ resourceKind: ' ', tags: [''] })).toBe('/api/document-generators/templates')
  })

  it('separates keys per filter', () => {
    expect(documentTemplatesQueryKey({ format: 'pdf' })).not.toEqual(documentTemplatesQueryKey({ format: 'md' }))
  })
})

describe('document history URL and key', () => {
  it('builds snake_case params and omits empties', () => {
    const url = buildDocumentHistoryUrl({
      resourceKind: 'sales.order',
      resourceId: 'r1',
      templateId: '',
      sort: 'generated_at',
      sortDirection: 'asc',
    })
    expect(url).toBe(
      '/api/document-generators/documents?page=1&pageSize=20&resource_kind=sales.order&resource_id=r1&sort=generated_at&sort_direction=asc',
    )
  })

  it('drops non-allowlisted sort fields', () => {
    expect(buildDocumentHistoryUrl({ sort: 'resource_label' as never })).not.toContain('sort=')
  })

  it('clamps pageSize to 100', () => {
    expect(buildDocumentHistoryUrl({ pageSize: 500 })).toContain('pageSize=100')
  })

  it('keeps resource identity in the key', () => {
    const a = documentHistoryQueryKey({ resourceKind: 'sales.order', resourceId: 'a' })
    const b = documentHistoryQueryKey({ resourceKind: 'sales.order', resourceId: 'b' })
    expect(a).not.toEqual(b)
    expect(JSON.stringify(a)).toContain('sales.order')
    expect(JSON.stringify(a)).toContain('"a"')
  })

  it('disables the resource variant without both ids', () => {
    expect(isDocumentHistoryQueryEnabled({ resourceKind: 'sales.order' }, { requireResource: true })).toBe(false)
    expect(isDocumentHistoryQueryEnabled({ resourceId: 'a' }, { requireResource: true })).toBe(false)
    expect(isDocumentHistoryQueryEnabled({ resourceKind: 'sales.order', resourceId: 'a' }, { requireResource: true })).toBe(true)
    expect(isDocumentHistoryQueryEnabled({}, {})).toBe(true)
  })
})

describe('document history filter state', () => {
  it('resets page to 1 on filter and sort change', () => {
    const paged = applyDocumentHistoryPage(createDocumentHistoryFilterState(), 4)
    expect(paged.page).toBe(4)
    expect(applyDocumentHistoryFilters(paged, { generatedBy: 'x' }).page).toBe(1)
    expect(applyDocumentHistorySort(paged, 'format', 'asc').page).toBe(1)
  })

  it('ignores non-allowlisted sort fields', () => {
    expect(applyDocumentHistorySort(createDocumentHistoryFilterState(), 'bogus', 'asc').sort).toBeNull()
  })

  it('falls back to the last valid page', () => {
    expect(resolveLastValidDocumentHistoryPage(5, 41, 20)).toBe(3)
    expect(resolveLastValidDocumentHistoryPage(2, 41, 20)).toBe(2)
    expect(resolveLastValidDocumentHistoryPage(3, 0, 20)).toBe(1)
  })
})
