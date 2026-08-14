import { buildDocumentHistoryUrl, documentHistoryQueryKey } from '../useDocumentHistory'

describe('document history query', () => {
  it('serializes pagination, filters, and sorting', () => {
    const query = {
      page: 2,
      pageSize: 20,
      templateId: 'sample-report',
      generatedBy: '5b59688c-7101-4fe7-b4b7-23c8ab83bb01',
      generatedFrom: '2026-08-01T00:00:00.000Z',
      generatedTo: '2026-08-14T23:59:59.999Z',
      sort: 'template_label' as const,
      sortDirection: 'asc' as const,
    }

    expect(buildDocumentHistoryUrl(query)).toBe(
      '/api/document-generators/documents?page=2&pageSize=20&sort=template_label&sort_direction=asc&template_id=sample-report&generated_by=5b59688c-7101-4fe7-b4b7-23c8ab83bb01&generated_from=2026-08-01T00%3A00%3A00.000Z&generated_to=2026-08-14T23%3A59%3A59.999Z',
    )
  })

  it('separates cached pages and filters', () => {
    const base = { page: 1, pageSize: 20, sort: 'generated_at' as const, sortDirection: 'desc' as const }
    expect(documentHistoryQueryKey(base)).not.toEqual(documentHistoryQueryKey({ ...base, page: 2 }))
    expect(documentHistoryQueryKey(base)).not.toEqual(documentHistoryQueryKey({ ...base, templateId: 'sample-report' }))
  })
})
