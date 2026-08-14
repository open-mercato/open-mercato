import {
  buildDocumentTemplateFilterDefinitions,
  documentTemplatesQueryFromFilterValues,
} from '../useDocumentTemplateFilters'

describe('document template filters', () => {
  it('maps UI filter values to the API query model', () => {
    expect(documentTemplatesQueryFromFilterValues({ resourceKind: 'example.record', format: 'pdf' }))
      .toEqual({ resourceKind: 'example.record', format: 'pdf' })
  })

  it('builds filter definitions from API options', () => {
    const t = (key: string, fallback?: string | Record<string, string | number>) => (
      typeof fallback === 'string' ? fallback : key
    )
    const filters = buildDocumentTemplateFilterDefinitions(t, {
      resourceKinds: ['example.record', 'example.report'],
      formats: ['md', 'pdf'],
    })

    expect(filters.map((filter) => filter.id)).toEqual(['resourceKind', 'format'])
    expect(filters[0]?.options?.map((option) => option.value)).toEqual(['example.record', 'example.report'])
    expect(filters[1]?.options?.map((option) => option.value)).toEqual(['md', 'pdf'])
  })
})
