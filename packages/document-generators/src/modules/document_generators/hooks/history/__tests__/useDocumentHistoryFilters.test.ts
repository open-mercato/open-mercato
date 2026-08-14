import {
  buildDocumentHistoryFilterDefinitions,
  buildDocumentHistoryQuery,
} from '../useDocumentHistoryFilters'

describe('document history filters', () => {
  it('maps UI values and sorting to the API query model', () => {
    const query = buildDocumentHistoryQuery({
      templateId: ' sample-report ',
      generatedBy: ' 5b59688c-7101-4fe7-b4b7-23c8ab83bb01 ',
      generatedAt: { from: '2026-08-01', to: '2026-08-14' },
    }, [{ id: 'templateLabel', desc: false }], 3, 20)

    expect(query).toMatchObject({
      page: 3,
      pageSize: 20,
      templateId: 'sample-report',
      generatedBy: '5b59688c-7101-4fe7-b4b7-23c8ab83bb01',
      sort: 'template_label',
      sortDirection: 'asc',
    })
    const expectedFrom = new Date('2026-08-01T00:00:00')
    const expectedTo = new Date('2026-08-14T00:00:00')
    expectedTo.setHours(23, 59, 59, 999)
    expect(query.generatedFrom).toBe(expectedFrom.toISOString())
    expect(query.generatedTo).toBe(expectedTo.toISOString())
  })

  it('builds the complete history filter form in one place', () => {
    const t = (key: string, fallback?: string | Record<string, string | number>) => (
      typeof fallback === 'string' ? fallback : key
    )

    expect(buildDocumentHistoryFilterDefinitions(t).map((filter) => filter.id))
      .toEqual(['templateId', 'generatedBy', 'generatedAt'])
  })
})
